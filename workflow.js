(function (root) {
  'use strict';

  function normalizeText(value) {
    return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '');
  }

  // Самодостаточная функция для chrome.scripting.executeScript.
  function submitPatientRegistration() {
    const normalize = value => String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '');
    const visible = element => element?.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
    if (location.origin !== 'https://reg.dev.m99.dzm' || !/^\/samotek(?:\/|$)/.test(location.pathname)) {
      throw new Error('Регистрация разрешена только на странице M99 DEV «Самотёк».');
    }
    const expected = normalize('Зарегистрировать и распечатать браслет');
    const buttons = Array.from(document.querySelectorAll('button')).filter(visible);
    const button = buttons.find(element => normalize(element.textContent) === expected);
    if (!button) return {state:'waiting',message:'Ожидание кнопки регистрации пациента.'};
    if (button.disabled || button.getAttribute('data-lu-disabled') === 'true') {
      return {state:'waiting',message:'Форма заполнена, но кнопка регистрации пока недоступна.'};
    }
    if (button.dataset.patientGeneratorSubmitted === 'true') {
      return {state:'submitted',message:'Регистрация отправлена, ожидается подтверждение системы.'};
    }
    button.dataset.patientGeneratorSubmitted = 'true';
    button.click();
    return {state:'submitted',message:'Регистрация отправлена, ожидается подтверждение системы.'};
  }

  // Проверяет результат и при наличии использует штатную кнопку перехода к триажу.
  // Самодостаточная функция для chrome.scripting.executeScript.
  function inspectSubmission(kind) {
    const normalize = value => String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '');
    const visible = element => element?.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
    if (location.origin !== 'https://reg.dev.m99.dzm') throw new Error('Недопустимый адрес страницы результата.');
    if (kind === 'registration') {
      const expected = normalize('Перейти к Триажу');
      const button = Array.from(document.querySelectorAll('button')).filter(visible)
        .find(element => normalize(element.textContent) === expected);
      if (button && !button.disabled && button.getAttribute('data-lu-disabled') !== 'true') {
        if (button.dataset.patientGeneratorSubmitted !== 'true') {
          button.dataset.patientGeneratorSubmitted = 'true';
          button.click();
        }
        return {state:'transitioned',message:'Пациент зарегистрирован. Выполнен переход к Триажу.'};
      }
    }
    const notices = Array.from(document.querySelectorAll('[role=alert],app-toast,.toast,.notification,.snackbar'))
      .filter(visible).map(element => String(element.textContent || '').trim()).filter(Boolean);
    const text = normalize(notices.join(' '));
    const errorWords = ['ошибка','неудалось','некоррект','обязательн','занят','существует'];
    if (errorWords.some(word => text.includes(normalize(word)))) {
      return {state:'error',message:notices.join(' ') || 'Система сообщила об ошибке.'};
    }
    const successWords = kind === 'triage'
      ? ['пациентраспределен','триажныйосмотрсохранен','успешнораспределен']
      : ['пациентзарегистрирован','успешнозарегистрирован','регистрациявыполнена'];
    if (successWords.some(word => text.includes(normalize(word)))) {
      return {state:'success',message:notices.join(' ') || 'Операция выполнена.'};
    }
    return {state:'waiting',message:'Ожидание подтверждения операции.'};
  }

  const api = {normalizeText, submitPatientRegistration, inspectSubmission};
  if (typeof module !== 'undefined') module.exports = api;
  root.PatientWorkflow = api;
})(globalThis);
