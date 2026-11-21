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
    series:['серия','серия паспорта','series','seriespass'], number:['номер','номер паспорта','number','numberpass'],
    issuer:['кем выдан','орган выдачи','issuer','whoissuedpass'], issueDate:['когда выдан','дата выдачи','issuedate','issueddate'],
    lastName:['фамилия','lastname','surname'], firstName:['имя','firstname'],
    middleName:['отчество','middlename','patronymic','secondname'], birthDate:['дата рождения','birthdate','birthday'],
    snils:['снилс','snils'], oms:['полис омс','номер полиса омс','енп','oms','polis'], sex:['пол','gender','sex']
  };
  const normalize = value => String(value || '').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]/gu,'');
  const masks = {series:'9999',number:'999999',snils:'99999999999',oms:'9999999999999999'};
  const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert]');
  const editable = el => visible(el) && !el.disabled && !el.readOnly && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !['hidden','submit','button','password','file'].includes(el.type);
  function names(el) {
    const wrapper = el.closest('lu-input-wrapper,lu-combobox,mat-form-field,label,.form-field,.input-wrapper');
    return [el.getAttribute('placeholder'),el.getAttribute('aria-label'),el.getAttribute('formcontrolname'),
      el.getAttribute('data-testid'),el.getAttribute('ng-reflect-name'),el.name,el.id,
      ...Array.from(el.labels || [], label => label.textContent),
      (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' '),
      wrapper?.textContent
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
      if (!mapping[key] && matches.length === 0 && masks[key]) {
        matches = controls.filter(el => normalize(el.getAttribute('lumask')) === masks[key]);
      }
    } catch { report.errors.push(key + ': неверный CSS-селектор'); continue; }
    if (key === 'documentType' && !mapping[key] && matches.length === 0) {
      const combos = Array.from(scope.querySelectorAll('lu-combobox')).filter(visible).filter(el =>
        normalize(el.getAttribute('placeholder') || el.textContent).includes('документудостоверяющийличность'));
      if (combos.length === 1) {plans.push({key,combo:combos[0]});continue;}
    }
    // Пол на скриншоте — отдельные checkbox/radio «Муж» и «Жен».
    if (key === 'sex' && !mapping[key]) {
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
    const hasValue = masks[key]
      ? !el.classList?.contains('hide-mask') && String(el.value || '').replace(/\D/g,'').length > 0
      : String(el.value || '').trim().length > 0;
    if (!replace && hasValue) {report.skipped.push(key + ': уже заполнено');continue;}
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
    const {key,el,male,female,combo} = plan;
    try {
      if (combo) {
        (combo.querySelector('input,[lufocuscatcher]') || combo).click();
        await new Promise(resolve => setTimeout(resolve, 150));
        const expectedDocuments = ['Паспорт гражданина Российской Федерации','Паспорт гражданина РФ'];
        const optionSelectors = '[role=option],lu-option,.lu-option,lu-data-list *';
        const options = Array.from(document.querySelectorAll(optionSelectors)).filter(visible).filter(item =>
          expectedDocuments.some(value => normalize(item.textContent) === normalize(value)));
        const option = options.sort((left,right) => left.children.length - right.children.length)[0];
        if (!option) throw new Error('выберите «Паспорт гражданина РФ» вручную');
        option.click();
        await new Promise(resolve => setTimeout(resolve, 100));
      } else if (male) {
        const selected = patient.sex === 'male' ? male : female;
        const other = patient.sex === 'male' ? female : male;
        if (other.checked) other.click();
        if (!selected.checked) selected.click();
        if (!selected.checked || other.checked) throw new Error('проверьте переключатели');
      } else {
        if (!el.isConnected) throw new Error('форма обновилась; повторите заполнение');
        let value = key.endsWith('Date') ? dateValue(key,el) : patient[key];
        if (key === 'sex') value = patient.sex === 'male' ? 'Мужской' : 'Женский';
        const mask = normalize(el.getAttribute('lumask'));
        if (key === 'series' && mask === masks.series) value = patient.series.replace(/(\d{2})(\d{2})/, '$1 $2');
        if (key === 'snils' && (mask === masks.snils || el.maxLength !== 11)) value = patient.snils.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1-$2-$3 $4');
        if (key === 'oms' && mask === masks.oms) value = patient.oms.replace(/(\d{4})(\d{4})(\d{4})(\d{4})/, '$1 $2 $3 $4');
        if (el.tagName === 'SELECT') {
          const expected = key === 'sex' ? (patient.sex === 'male' ? ['мужской','муж','male'] : ['женский','жен','female'])
            : key === 'documentType' ? ['Паспорт гражданина Российской Федерации','Паспорт гражданина РФ','Паспорт РФ'] : [value];
          const options = Array.from(el.options).filter(o => !o.disabled && expected.some(v => normalize(o.textContent) === normalize(v) || normalize(o.value) === normalize(v)));
          if (options.length !== 1) throw new Error('выберите значение в списке вручную');
          value = options[0].value;
        } else if (key === 'documentType' || el.getAttribute('role') === 'combobox') {
          throw new Error('нестандартный список: выберите вручную');
        }
        if (mask && masks[key] && typeof document.execCommand === 'function') {
          el.focus();
          setValue(el,'');
          if (typeof el.select === 'function') el.select();
          document.execCommand('insertText', false, String(patient[key]).replace(/\D/g,''));
          el.dispatchEvent(new Event('change',{bubbles:true}));
          el.dispatchEvent(new FocusEvent('blur',{bubbles:false}));
          await new Promise(resolve => setTimeout(resolve, 60));
          if (String(el.value).replace(/\D/g,'') !== patient[key]) setValue(el,value);
        } else setValue(el,value);
        await new Promise(resolve => setTimeout(resolve, 40));
        const equivalent = ['series','number','snils','oms'].includes(key)
          ? String(el.value).replace(/\D/g,'') === patient[key] : el.value === value;
        if (!equivalent) throw new Error('форма не приняла значение');
      }
      report.filled.push(key);
    } catch (error) {report.errors.push(key + ': ' + error.message);}
  }
  return report;
}
if (typeof module !== 'undefined') module.exports = {fillPatientForm};
