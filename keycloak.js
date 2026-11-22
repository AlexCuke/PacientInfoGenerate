(function (root) {
  'use strict';

  // Самодостаточная функция для chrome.scripting.executeScript.
  async function keycloakAutoLogin(settings) {
    if (location.origin !== 'https://keycloak.dev.m99.dzm') throw new Error('Недопустимый адрес Keycloak.');
    const visible = el => el?.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const normalize = value => String(value || '').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]/gu,'');
    const setValue = (el,value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
    };
    const username = document.querySelector('#loginInput,input[name=loginInput],#username,input[name=username]');
    const password = document.querySelector('#passwordInput,input[name=passwordInput],#password,input[name=password]');
    if (visible(username) && visible(password)) {
      if (!settings.username || !settings.password) return {state:'credentials-missing'};
      setValue(username,settings.username);setValue(password,settings.password);
      const submit = document.querySelector('#next,input[name=next],#kc-login,input[name=login],button[type=submit],input[type=submit]');
      if (!submit) throw new Error('Не найдена кнопка входа Keycloak.');
      const form = username.closest?.('form') || document.querySelector('#kc-form-login');
      if (typeof form?.requestSubmit === 'function') form.requestSubmit(submit);
      else submit.click();
      return {state:'login-submitted'};
    }

    const profileSelect = document.querySelector('#profileInput,select[name=profileInput]');
    if (visible(profileSelect)) {
      const expectedProfile = settings.profile || 'С8 ПО - Старшая медицинская сестра';
      const option = Array.from(profileSelect.options).find(item => normalize(item.textContent) === normalize(expectedProfile));
      if (!option) throw new Error('Профиль «' + expectedProfile + '» отсутствует у пользователя.');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(profileSelect,option.value);
      profileSelect.dispatchEvent(new Event('input',{bubbles:true}));
      profileSelect.dispatchEvent(new Event('change',{bubbles:true}));
      const submit = Array.from(document.querySelectorAll('button[type=submit],input[type=submit],button,input[type=button]')).filter(visible)
        .find(el => normalize(el.textContent || el.value).includes('войти'));
      if (!submit) throw new Error('Не найдена кнопка «Войти» после выбора профиля.');
      const form = profileSelect.closest?.('form') || document.querySelector('form');
      if (typeof form?.requestSubmit === 'function' && submit.type === 'submit') form.requestSubmit(submit);
      else submit.click();
      return {state:'profile-selected'};
    }

    const expected = [settings.profile].filter(Boolean).map(normalize);
    const candidates = Array.from(document.querySelectorAll('button,a,label,[role=button],tr,.profile-card,.user-profile'))
      .filter(visible).filter(el => expected.every(value => normalize(el.textContent).includes(value)))
      .sort((left,right) => left.textContent.length - right.textContent.length);
    if (candidates.length) {
      candidates[0].click();
      await new Promise(resolve => setTimeout(resolve,80));
      const confirm = Array.from(document.querySelectorAll('button,input[type=submit],a[role=button]')).filter(visible)
        .find(el => ['выбрать','продолжить','войти'].some(value => normalize(el.textContent || el.value).includes(normalize(value))));
      confirm?.click();
      return {state:'profile-selected'};
    }
    return {state:'no-login-form'};
  }

  const api = {keycloakAutoLogin};
  if (typeof module !== 'undefined') module.exports = api;
  root.KeycloakAutomation = api;
})(globalThis);
