(function (root) {
  'use strict';

  function createTriageValues(patient, random = Math.random) {
    const integer = (min, max) => min + Math.floor(random() * (max - min + 1));
    const pick = values => values[Math.min(values.length - 1, Math.floor(random() * values.length))];
    const systolic = integer(110, 140);
    return {
      spo2: String(integer(95, 100)), chdd: String(integer(12, 20)), chss: String(integer(60, 100)),
      pressureSys: String(systolic), pressureDia: String(integer(70, Math.min(90, systolic - 20))),
      temp: (integer(361, 374) / 10).toFixed(1), pain: integer(1, 10),
      consciousness: pick(['ясное','спутанность - дезориентация','оглушение','сопор - кома']),
      bleeding: pick(['Есть','Нет']), pregnancy: patient?.sex === 'female' ? pick(['нет','беременность менее 22 недель','беременность более 22 недель']) : 'нет',
      recentVisit: pick(['Есть','Нет']), oncology: pick(['Есть','Нет']), hemodialysis: pick(['Есть','Нет']),
      allergy: pick(['Да','Нет']), intoxication: pick(['Есть','Нет']), transport: pick(['сидя','лежа','не требуется'])
    };
  }

  // Самодостаточная функция для chrome.scripting.executeScript.
  async function advanceTriage(patient, values, options, origin = 'https://reg.dev.m99.dzm') {
    if (location.origin !== origin) throw new Error('Недопустимый адрес страницы триажа.');
    options = options || {};
    const normalize = value => String(value || '').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]/gu,'');
    const visible = el => el?.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const path = location.pathname;
    if (path === '/medreg' || path === '/medreg/') {
      const triageTab = Array.from(document.querySelectorAll('[role=tab],lu-tab-header-item'))
        .find(el => visible(el) && normalize(el.textContent) === 'триаж');
      if (triageTab?.getAttribute('data-lu-selected') !== 'true') {
        triageTab?.click();
        await wait(300);
      }
      const fullName = normalize([patient.lastName, patient.firstName, patient.middleName].filter(Boolean).join(' '));
      const oms = String(patient.oms || '').replace(/\D/g,'');
      const rows = Array.from(document.querySelectorAll('[data-test-role=tableRow],cdk-row')).filter(visible);
      const matches = rows.filter(row => normalize(row.textContent).includes(fullName) &&
        (!oms || String(row.textContent).replace(/\D/g,'').includes(oms)));
      if (matches.length !== 1) return {state:'waiting', message:matches.length ? 'Найдено несколько пациентов.' : 'Пациент пока не найден в списке ТРИАЖ.'};
      const open = matches[0].querySelector('[data-lu-icon=chevron-right]')?.closest('button') || matches[0];
      open.click();
      return {state:'opening', message:'Пациент найден, открывается триажный осмотр.'};
    }
    if (!/^\/triage(?:\/|$)/.test(path)) return {state:'waiting', message:'Ожидание списка ТРИАЖ.'};

    const header = normalize(document.querySelector('.header-info')?.textContent);
    const fullName = normalize([patient.lastName, patient.firstName, patient.middleName].filter(Boolean).join(' '));
    if (!header.includes(fullName)) throw new Error('Открыт триаж другого пациента. Заполнение остановлено.');

    function nativeValue(el, value) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
    }
    async function fillMasked(name, value) {
      const el = document.querySelector('input[name="' + name + '"]');
      if (!el || !visible(el)) throw new Error('Не найдено поле ' + name + '.');
      el.focus();nativeValue(el,'');if (typeof el.select === 'function') el.select();
      const raw = String(value).replace(/\D/g,'');
      if (typeof document.execCommand === 'function') document.execCommand('insertText',false,raw);
      if (String(el.value).replace(/\D/g,'') !== raw) nativeValue(el,value);
      el.dispatchEvent(new FocusEvent('blur',{bubbles:false}));
      await wait(30);
      if (String(el.value).replace(/\D/g,'') !== raw) throw new Error('Форма не приняла поле ' + name + '.');
    }
    function choose(groupText, value) {
      const group = Array.from(document.querySelectorAll('.group-col')).find(el =>
        normalize(el.querySelector('.group-label,.score-slider-label')?.textContent).includes(normalize(groupText)));
      if (!group) throw new Error('Не найдена группа «' + groupText + '».');
      const button = Array.from(group.querySelectorAll('button')).find(el => normalize(el.textContent) === normalize(value));
      if (!button) throw new Error('Нет значения «' + value + '» в группе «' + groupText + '».');
      button.click();
    }
    async function chooseCombobox(name) {
      const combo = document.querySelector('lu-combobox[name="' + name + '"]');
      if (!combo || !visible(combo)) return;
      const input = combo.querySelector('input');
      if (String(input?.value || '').trim()) return;
      (input || combo).click();await wait(120);
      const options = Array.from(document.querySelectorAll('lu-data-list *')).filter(el =>
        visible(el) && String(el.textContent || '').trim() && el.children.length === 0);
      if (!options.length) throw new Error('Не удалось выбрать значение списка ' + name + '.');
      options[Math.floor(Math.random() * options.length)].click();await wait(120);
    }
    await fillMasked('spo2',values.spo2);await fillMasked('chdd',values.chdd);await fillMasked('chss',values.chss);
    await fillMasked('pressureSys',values.pressureSys);await fillMasked('pressureDia',values.pressureDia);await fillMasked('temp',values.temp);
    choose('Уровень сознания',values.consciousness);choose('Кровотечение',values.bleeding);
    const painDots = Array.from(document.querySelectorAll('.score-slider-custom .score-slider-dot')).filter(visible);
    if (values.pain > 1) painDots[values.pain - 2]?.click();
    choose('Наличие беременности',values.pregnancy);choose('Факт обращения',values.recentVisit);
    choose('Онкология',values.oncology);choose('Гемодиализ',values.hemodialysis);
    choose('Наличие аллергии',values.allergy);choose('Признаки алкогольного',values.intoxication);
    choose('Способ транспортировки',values.transport);
    await chooseCombobox('doctorSpecialty');await chooseCombobox('patientCondition');
    if (options.submit) {
      const expected = normalize('Распределить пациента');
      const submit = Array.from(document.querySelectorAll('button')).filter(visible)
        .find(button => normalize(button.textContent) === expected);
      if (!submit) return {state:'waiting', message:'Ожидание кнопки «Распределить пациента».', values};
      if (submit.disabled || submit.getAttribute('data-lu-disabled') === 'true') {
        return {state:'waiting', message:'Форма заполнена, но кнопка «Распределить пациента» пока недоступна.', values};
      }
      if (submit.dataset.patientGeneratorSubmitted !== 'true') {
        submit.dataset.patientGeneratorSubmitted = 'true';
        submit.click();
      }
      return {state:'submitted', message:'Триаж отправлен, ожидается подтверждение распределения пациента.', values};
    }
    return {state:'filled', message:'Триажный осмотр заполнен. Проверьте значения перед распределением пациента.', values};
  }

  const api = {createTriageValues, advanceTriage};
  if (typeof module !== 'undefined') module.exports = api;
  root.PatientTriage = api;
})(globalThis);
