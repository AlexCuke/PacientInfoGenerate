'use strict';
const api = PatientGenerator;
const $ = id => document.getElementById(id);
let patient;
function status(message) { $('status').textContent = message; }
async function copy(value) {
  try { await navigator.clipboard.writeText(value); status('Скопировано.'); }
  catch { status('Буфер обмена недоступен. Выделите нужное значение и нажмите Ctrl+C.'); }
}
function render() {
  $('fields').replaceChildren();
  for (const [key,label] of Object.entries(api.fields)) {
    const row = document.createElement('div');row.className = 'field';
    const title = document.createElement('span');title.className = 'field-label';title.textContent = label;
    const value = document.createElement('span');value.className = 'field-value';value.textContent = api.display(key,patient[key]);
    const button = document.createElement('button');button.textContent = '⧉';button.title = 'Копировать: ' + label;button.setAttribute('aria-label',button.title);
    button.addEventListener('click', () => copy(api.display(key,patient[key])));
    row.append(title,value,button);$('fields').append(row);
  }
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
async function init() {
  try {
    const session = await chrome.storage.session.get('currentPatient');
    if (session.currentPatient) {patient=session.currentPatient;render();}
    else generate();
  } catch (error) {status('Настройки недоступны: ' + error.message);}
  if (!patient) generate();
}
init();
