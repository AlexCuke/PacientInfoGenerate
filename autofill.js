// Самодостаточная функция: передаётся chrome.scripting.executeScript без внешних замыканий.
async function fillPatientForm(patient, mapping, replace) {
  'use strict';
  mapping = mapping || {};
  replace = Boolean(replace);
  if (location.origin !== 'https://reg.dev.m99.dzm' || !/^\/samotek(?:\/|$)/.test(location.pathname)) {
    throw new Error('Заполнение разрешено только на https://reg.dev.m99.dzm/samotek');
  }
  const aliases = {
    documentType:['документ удостоверяющий личность','вид документа','тип документа'],
    series:['серия','серия паспорта'], number:['номер','номер паспорта'],
    issuer:['кем выдан','орган выдачи'], issueDate:['когда выдан','дата выдачи'],
    lastName:['фамилия','lastname','surname'], firstName:['имя','firstname'],
    middleName:['отчество','middlename','patronymic'], birthDate:['дата рождения','birthdate','birthday'],
    snils:['снилс','snils'], oms:['полис омс','номер полиса омс','енп','oms'], sex:['пол','gender','sex']
  };
  const normalize = value => String(value || '').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]/gu,'');
  const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert]');
  const editable = el => visible(el) && !el.disabled && !el.readOnly && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !['hidden','submit','button','password','file'].includes(el.type);
  function names(el) {
    return [el.getAttribute('placeholder'),el.getAttribute('aria-label'),el.name,el.id,
      ...Array.from(el.labels || [], label => label.textContent),
      (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ')
    ].filter(Boolean).map(normalize);
  }
  const roots = Array.from(document.querySelectorAll('[role=dialog],dialog[open]')).filter(visible);
  const scope = roots.length === 1 ? roots[0] : document;
  const controls = Array.from(scope.querySelectorAll('input,select,textarea')).filter(editable);
  const report = {filled:[], skipped:[], errors:[]};
  const used = new Set();
  const plans = [];
  for (const [key, expected] of Object.entries(aliases)) {
    let matches;
    try {
      matches = mapping[key] ? Array.from(scope.querySelectorAll(mapping[key])).filter(editable)
        : controls.filter(el => names(el).some(name => expected.some(label => normalize(label) === name)));
    } catch { report.errors.push(key + ': неверный CSS-селектор'); continue; }
    // Пол на скриншоте — отдельные checkbox/radio «Муж» и «Жен».
    if (key === 'sex' && !mapping[key] && matches.length === 0) {
      const choices = controls.filter(el => ['checkbox','radio'].includes(el.type));
      const male = choices.filter(el => names(el).some(n => ['муж','мужской','male'].includes(n)));
      const female = choices.filter(el => names(el).some(n => ['жен','женский','female'].includes(n)));
      if (male.length === 1 && female.length === 1) {
        if (!replace && (male[0].checked || female[0].checked)) {report.skipped.push('sex: уже выбран');continue;}
        plans.push({key, male:male[0], female:female[0]}); continue;
      }
    }
    if (matches.length !== 1) {report.skipped.push(key + (matches.length ? ': несколько полей' : ': не найдено'));continue;}
    const el = matches[0];
    if (used.has(el)) {report.skipped.push(key + ': поле уже назначено');continue;}
    used.add(el);
    if (['checkbox','radio'].includes(el.type)) {report.skipped.push(key + ': настройте выбор вручную');continue;}
    if (!replace && String(el.value || '').trim()) {report.skipped.push(key + ': уже заполнено');continue;}
    plans.push({key,el});
  }
  const dateValue = (key, el) => el.type === 'date' ? patient[key] : patient[key].split('-').reverse().join('.');
  function setValue(el, value) {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    el.dispatchEvent(new FocusEvent('blur',{bubbles:false}));
  }
  for (const plan of plans) {
    const {key,el,male,female} = plan;
    try {
      if (male) {
        const selected = patient.sex === 'male' ? male : female;
        const other = patient.sex === 'male' ? female : male;
        if (other.checked) other.click();
        if (!selected.checked) selected.click();
        if (!selected.checked || other.checked) throw new Error('проверьте переключатели');
      } else {
        if (!el.isConnected) throw new Error('форма обновилась; повторите заполнение');
        let value = key.endsWith('Date') ? dateValue(key,el) : patient[key];
        if (key === 'sex') value = patient.sex === 'male' ? 'Мужской' : 'Женский';
        if (key === 'snils' && el.maxLength !== 11) value = patient.snils.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1-$2-$3 $4');
        if (el.tagName === 'SELECT') {
          const expected = key === 'sex' ? (patient.sex === 'male' ? ['мужской','муж','male'] : ['женский','жен','female'])
            : key === 'documentType' ? ['Паспорт гражданина Российской Федерации','Паспорт гражданина РФ','Паспорт РФ'] : [value];
          const options = Array.from(el.options).filter(o => !o.disabled && expected.some(v => normalize(o.textContent) === normalize(v) || normalize(o.value) === normalize(v)));
          if (options.length !== 1) throw new Error('выберите значение в списке вручную');
          value = options[0].value;
        } else if (key === 'documentType' || el.getAttribute('role') === 'combobox') {
          throw new Error('нестандартный список: выберите вручную');
        }
        setValue(el,value);
        await new Promise(resolve => setTimeout(resolve, 40));
        const equivalent = key === 'snils' || key === 'oms' ? String(el.value).replace(/\D/g,'') === patient[key] : el.value === value;
        if (!equivalent) throw new Error('форма не приняла значение');
      }
      report.filled.push(key);
    } catch (error) {report.errors.push(key + ': ' + error.message);}
  }
  return report;
}
if (typeof module !== 'undefined') module.exports = {fillPatientForm};
