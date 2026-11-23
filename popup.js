'use strict';
const api = PatientGenerator;
const $ = id => document.getElementById(id);
let patient;
const environmentSelect = $('browserEnvironment');
for (const environment of Object.keys(BrowserEnvironments.origins)) {
  environmentSelect.add(new Option(environment, environment));
}
environmentSelect.addEventListener('change', async () => {
  try {
    await chrome.storage.local.set({browserEnvironment:environmentSelect.value});
  } catch (error) {status('Не удалось сохранить выбранный контур: ' + error.message);}
});
function status(message) { $('status').textContent = message; }
function autofillReport(result) {
  const parts = ['Заполнено: ' + result.filled.length + '.'];
  if (result.skipped.length) parts.push('Пропущено: ' + result.skipped.join('; ') + '.');
  if (result.errors.length) parts.push('Проверьте вручную: ' + result.errors.join('; ') + '.');
  return parts.join('\n');
}
async function copy(value) {
  try { await navigator.clipboard.writeText(value); status('Скопировано.'); }
  catch { status('Буфер обмена недоступен. Выделите нужное значение и нажмите Ctrl+C.'); }
}
function render() {
  $('fields').replaceChildren();
  for (const [label, formattedValue] of api.entries(patient)) {
    const row = document.createElement('div');row.className = 'field';
    const title = document.createElement('span');title.className = 'field-label';title.textContent = label;
    const value = document.createElement('span');value.className = 'field-value';value.textContent = formattedValue;
    const button = document.createElement('button');button.textContent = '⧉';button.title = 'Копировать: ' + label;button.setAttribute('aria-label',button.title);
    button.addEventListener('click', () => copy(formattedValue));
    row.append(title,value,button);$('fields').append(row);
  }
  Hospitalization.setPatient(patient);
}
function generate() {
  try {
    patient = api.generate({sex:$('sex').value,age:$('age').value === '' ? undefined : Number($('age').value)});
    render();status('');
    chrome.storage.session.set({currentPatient:patient}).catch(() => {});
    return patient;
  } catch (error) {status(error.message);}
  return null;
}
$('generate').addEventListener('click',generate);
$('runCompleteWorkflow').addEventListener('click', async () => {
  const button = $('runCompleteWorkflow');
  try {
    button.disabled = true;
    const generated = generate();
    if (!generated) throw new Error('Не удалось сгенерировать пациента.');
    const response = await chrome.runtime.sendMessage({
      type:'run-complete-workflow',patient:generated,environment:environmentSelect.value
    });
    if (response?.error) throw new Error(response.error);
    status('Полный сценарий запущен: открываю регистрацию, затем зарегистрирую пациента и проведу триаж.');
  } catch (error) {status('Не удалось запустить полный сценарий: ' + error.message);}
  finally {button.disabled = false;}
});
$('copyAll').addEventListener('click',() => copy(api.text(patient)));
$('saveKeycloak').addEventListener('click',async()=>{
  try {
    const username=$('keycloakUsername').value.trim(),password=$('keycloakPassword').value;
    const autoLogin=$('keycloakAutoLogin').checked,rememberPassword=$('keycloakRememberPassword').checked;
    if (!username || !password) throw new Error('Введите логин и пароль.');
    const settings={username,autoLogin,rememberPassword,profile:$('keycloakProfile').value};
    await chrome.storage.local.set({keycloakSettings:{...settings,...rememberPassword?{password}:{}}});
    await chrome.storage.session.set({keycloakSessionPassword:rememberPassword?null:password});
    await chrome.runtime.sendMessage({type:'keycloak-settings-updated'});
    status('Настройки Keycloak сохранены.' + (rememberPassword?' Пароль сохранён локально на этом компьютере.':' Пароль сохранён только до закрытия браузера.'));
  } catch(error){status('Не удалось сохранить вход: '+error.message);}
});
$('clearKeycloak').addEventListener('click',async()=>{
  await Promise.all([chrome.storage.local.remove('keycloakSettings'),chrome.storage.session.remove('keycloakSessionPassword')]);
  $('keycloakUsername').value='';$('keycloakPassword').value='';$('keycloakProfile').value='С8 ПО - Старшая медицинская сестра';
  $('keycloakAutoLogin').checked=false;$('keycloakRememberPassword').checked=false;
  status('Данные входа удалены.');
});
$('openAndAutofillSamotek').addEventListener('click', async () => {
  const button = $('openAndAutofillSamotek');
  try {
    button.disabled = true;
    const response = await chrome.runtime.sendMessage({
      type:'open-and-autofill-samotek', patient, replace:$('replaceSamotek').checked, environment:environmentSelect.value
    });
    if (response?.error) throw new Error(response.error);
    status('Самотёк открыт. Автозаполнение начнётся после загрузки формы. Если открылся Keycloak, завершите вход — ожидание продолжится в фоне.');
  } catch (error) {status('Не удалось открыть Самотёк: ' + error.message);}
  finally {button.disabled = false;}
});
$('openSamotek').addEventListener('click', async () => {
  try {
    const origin = BrowserEnvironments.originFor(environmentSelect.value);
    await chrome.tabs.create({url:origin + '/samotek'});
    status('Самотёк открыт. Для ручного заполнения используйте кнопки ⧉ в карточке.');
  } catch (error) {status('Не удалось открыть Самотёк: ' + error.message);}
});
$('generateTriage').addEventListener('click', async () => {
  const button = $('generateTriage');
  try {
    button.disabled = true;
    const response = await chrome.runtime.sendMessage({type:'generate-triage',patient,environment:environmentSelect.value});
    if (response?.error) throw new Error(response.error);
    status('Открыт список ТРИАЖ. Ищу пациента по ФИО и ОМС, затем заполню осмотр случайными значениями.');
  } catch (error) {status('Не удалось запустить триаж: ' + error.message);}
  finally {button.disabled = false;}
});
$('autofillSamotek').addEventListener('click', async () => {
  const button = $('autofillSamotek');
  try {
    button.disabled = true;
    const origin = BrowserEnvironments.originFor(environmentSelect.value);
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id || !BrowserEnvironments.isSamotek(tab.url, origin)) {
      throw new Error('Откройте вкладку ' + origin + '/samotek и форму пациента.');
    }
    const [{result}] = await chrome.scripting.executeScript({
      target:{tabId:tab.id}, func:fillPatientForm,
      args:[patient, {}, $('replaceSamotek').checked, origin]
    });
    if (!result) throw new Error('Страница не вернула результат заполнения.');
    status(autofillReport(result));
  } catch (error) {
    status('Автозаполнение не выполнено: ' + error.message);
  } finally {button.disabled = false;}
});
async function init() {
  try {
    const [session,local] = await Promise.all([
      chrome.storage.session.get(['currentPatient','samotekAutofillJob','triageJob','completeWorkflowJob','keycloakSessionPassword','keycloakAuthStatus']),
      chrome.storage.local.get(['keycloakSettings','browserEnvironment'])
    ]);
    if (Object.hasOwn(BrowserEnvironments.origins, local.browserEnvironment)) {
      environmentSelect.value = local.browserEnvironment;
    }
    const login=local.keycloakSettings||{};
    $('keycloakUsername').value=login.username||'';$('keycloakPassword').value=login.password||session.keycloakSessionPassword||'';
    $('keycloakProfile').value=login.profile||'С8 ПО - Старшая медицинская сестра';
    $('keycloakAutoLogin').checked=Boolean(login.autoLogin);$('keycloakRememberPassword').checked=Boolean(login.rememberPassword);
    if (session.keycloakAuthStatus?.state === 'error' || session.keycloakAuthStatus?.state === 'no-login-form') {
      status('Keycloak: ' + session.keycloakAuthStatus.message);
    }
    if (session.currentPatient) {
      patient = session.currentPatient;
      render();
    } else generate();
    const job = session.samotekAutofillJob;
    if (job?.state === 'done' && job.report) status('Открытие и автозаполнение завершено.\n' + autofillReport(job.report));
    else if (job?.state === 'error') status('Открытие выполнено, но автозаполнение не удалось: ' + job.message);
    else if (job?.state === 'waiting') status('Ожидается загрузка формы «Самотёка» или завершение входа через Keycloak.');
    const triage = session.triageJob;
    if (triage?.state === 'done') status('Триажный осмотр заполнен. Проверьте значения перед распределением пациента.');
    else if (triage?.state === 'error') status('Не удалось заполнить триаж: ' + triage.message);
    else if (triage?.state === 'waiting') status(triage.message || 'Выполняется поиск пациента в списке ТРИАЖ.');
    const workflowJob = session.completeWorkflowJob;
    if (workflowJob?.state === 'done') status('Полный сценарий завершён: пациент зарегистрирован и распределён после триажного осмотра.');
    else if (workflowJob?.state === 'error') status('Полный сценарий остановлен: ' + workflowJob.message);
    else if (workflowJob?.state === 'waiting' || workflowJob?.state === 'running') status(workflowJob.message || 'Выполняется полный сценарий.');
  } catch (error) {status('Настройки недоступны: ' + error.message);}
  if (!patient) generate();
}
init();
