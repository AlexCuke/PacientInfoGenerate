'use strict';

const $ = id => document.getElementById(id);
const {environments, caseFields, register} = PatientRegistration;
const inputs = {};
let patient;

function status(message) {
  $('status').textContent = message;
}

function setDisabled(disabled) {
  $('configuration').disabled = disabled;
  $('caseDetails').disabled = disabled;
  $('submitRegistration').disabled = disabled;
}

for (const [name, url] of Object.entries(environments)) {
  $('environment').add(new Option(name + ' · ' + new URL(url).hostname, name));
}
for (const [key, [title, value]] of Object.entries(caseFields)) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'text';
  input.required = true;
  input.value = value;
  inputs[key] = input;
  label.append(title, input);
  $('caseFields').append(label);
}
$('processId').addEventListener('input', () => {
  $('preparation').hidden = Boolean($('processId').value.trim());
});

function showStep({operation, id, result}) {
  if (result === undefined) {
    status('Выполняется ' + operation + '…' + (id ? '\nProcess ID · ' + id : ''));
    return;
  }
  const step = document.createElement('details');
  const title = document.createElement('summary');
  const body = document.createElement('pre');
  title.textContent = operation + (id ? ' · ' + id : '');
  body.textContent = JSON.stringify(result, null, 2);
  step.append(title, body);
  $('steps').append(step);
  $('trace').hidden = false;
}

$('registrationForm').addEventListener('submit', async event => {
  event.preventDefault();
  const environment = $('environment').value;
  const processId = $('processId').value.trim();
  const workflow = $('workflow').value;
  const details = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value]));
  if (!processId && !patient) {
    status('Сгенерируйте пациента или укажите Process ID готового черновика.');
    return;
  }
  const target = processId || [patient.lastName, patient.firstName, patient.middleName].join(' ');
  if (!window.confirm('Зарегистрировать стационарный случай в контуре ' + environment + '?\n' + target)) return;

  setDisabled(true);
  let lastStep;
  let completed = false;
  try {
    const granted = await chrome.permissions.request({origins: [environments[environment] + '/*']});
    if (!granted) {
      status('Для отправки разрешите доступ к сервису регистрации.');
      return;
    }
    $('trace').hidden = true;
    $('steps').replaceChildren();
    const {id} = await register({environment, patient, processId, workflow, details, onStep(step) {
      lastStep = step;
      showStep(step);
    }});
    completed = true;
    status('Стационарный случай зарегистрирован.\nProcess ID · ' + id);
  } catch (error) {
    const id = lastStep?.id;
    const message = lastStep?.operation === 'POST /register'
      ? '\nПроверьте результат по Process ID перед повторной отправкой.'
      : '';
    status(error.message + (id ? '\nProcess ID · ' + id : '') + message);
  } finally {
    if (!completed) setDisabled(false);
  }
});

async function init() {
  try {
    ({currentPatient: patient} = await chrome.storage.session.get('currentPatient'));
    if (patient) {
      $('patientName').textContent = [patient.lastName, patient.firstName, patient.middleName].join(' ');
      $('patientData').textContent = PatientGenerator.text(patient);
    } else {
      $('patientName').textContent = 'Карточка пациента не загружена';
    }
  } catch (error) {
    status('Не удалось загрузить карточку. ' + error.message);
  } finally {
    setDisabled(false);
  }
}
init();
