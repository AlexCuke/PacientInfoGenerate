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
    patient = api.generate({mode:$('mode').value,sex:$('sex').value,age:$('age').value === '' ? undefined : Number($('age').value)});
    render();status('');
    chrome.storage.session.set({currentPatient:patient}).catch(() => {});
  } catch (error) {status(error.message);}
}
function updateControls() {
  const elastic = $('mode').value === 'elastic';
  $('sex').disabled = elastic;
  $('age').disabled = elastic;
}
$('mode').addEventListener('change', updateControls);
$('generate').addEventListener('click',generate);
$('copyAll').addEventListener('click',() => copy(api.text(patient)));
async function init() {
  try {
    const session = await chrome.storage.session.get('currentPatient');
    if (session.currentPatient) {
      patient = session.currentPatient;
      $('mode').value = patient.metadata?.mode === 'elastic' ? 'elastic' : 'standard';
      updateControls();
      render();
    } else generate();
  } catch (error) {status('Настройки недоступны: ' + error.message);}
  if (!patient) generate();
}
init();
