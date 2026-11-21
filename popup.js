'use strict';
const api = PatientGenerator;
const $ = id => document.getElementById(id);
let patient;
const SAMOTEK_URL = 'https://reg.dev.m99.dzm/samotek';
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
  } catch (error) {status(error.message);}
}
$('generate').addEventListener('click',generate);
$('copyAll').addEventListener('click',() => copy(api.text(patient)));
$('openAndAutofillSamotek').addEventListener('click', async () => {
  const button = $('openAndAutofillSamotek');
  try {
    button.disabled = true;
    const response = await chrome.runtime.sendMessage({
      type:'open-and-autofill-samotek', patient, replace:$('replaceSamotek').checked
    });
    if (response?.error) throw new Error(response.error);
    status('Самотёк открыт. Автозаполнение начнётся после загрузки формы. Если открылся Keycloak, завершите вход — ожидание продолжится в фоне.');
  } catch (error) {status('Не удалось открыть Самотёк: ' + error.message);}
  finally {button.disabled = false;}
});
$('openSamotek').addEventListener('click', async () => {
  try {
    await chrome.tabs.create({url:SAMOTEK_URL});
    status('Самотёк открыт. Войдите через Keycloak и выберите профиль Тимофеева Е.А. · 1 С8 ПО · Старшая медицинская сестра. Для ручного заполнения используйте кнопки ⧉ в карточке.');
  } catch (error) {status('Не удалось открыть Самотёк: ' + error.message);}
});
$('generateTriage').addEventListener('click', async () => {
  const button = $('generateTriage');
  try {
    button.disabled = true;
    const response = await chrome.runtime.sendMessage({type:'generate-triage',patient});
    if (response?.error) throw new Error(response.error);
    status('Открыт список ТРИАЖ. Ищу пациента по ФИО и ОМС, затем заполню осмотр случайными значениями.');
  } catch (error) {status('Не удалось запустить триаж: ' + error.message);}
  finally {button.disabled = false;}
});
$('autofillSamotek').addEventListener('click', async () => {
  const button = $('autofillSamotek');
  try {
    button.disabled = true;
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id || !tab.url?.startsWith('https://reg.dev.m99.dzm/samotek')) {
      throw new Error('Откройте вкладку https://reg.dev.m99.dzm/samotek и форму пациента.');
    }
    const [{result}] = await chrome.scripting.executeScript({
      target:{tabId:tab.id}, func:fillPatientForm,
      args:[patient, {}, $('replaceSamotek').checked]
    });
    if (!result) throw new Error('Страница не вернула результат заполнения.');
    status(autofillReport(result));
  } catch (error) {
    status('Автозаполнение не выполнено: ' + error.message);
  } finally {button.disabled = false;}
});
async function init() {
  try {
    const session = await chrome.storage.session.get(['currentPatient','samotekAutofillJob','triageJob']);
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
  } catch (error) {status('Настройки недоступны: ' + error.message);}
  if (!patient) generate();
}
init();
