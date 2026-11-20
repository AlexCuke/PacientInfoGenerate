const Hospitalization = (() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const {environments, caseFields} = PatientRegistration;
  const environment = $('environment');
  const processId = $('processId');
  const inputs = {};
  let profiles = {};
  let patient;
  let job;
  let initialized = false;
  let starting = false;
  let saving = false;

  function status(message) {
    $('hospitalizationStatus').textContent = message;
  }

  function updateControls() {
    const busy = !initialized || starting || job?.state === 'running';
    const draftId = processId.value.trim();
    const sameTarget = job?.state === 'done' && job.environment === environment.value &&
      (draftId ? job.id === draftId : !job.processId && job.snils === patient?.snils);
    $('submitRegistration').disabled = busy || !environment.value || sameTarget || (!patient && !draftId);
    $('caseDetails').disabled = busy || !environment.value || saving;
    $('configuration').disabled = busy;
  }

  for (const name of Object.keys(environments)) environment.add(new Option(name, name));
  for (const [key, [title]] of Object.entries(caseFields)) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'text';
    inputs[key] = input;
    label.append(title, input);
    $('caseFields').append(label);
  }

  function loadProfile() {
    for (const [key, [, fallback]] of Object.entries(caseFields)) {
      inputs[key].value = profiles[environment.value]?.[key] ?? (environment.value ? fallback : '');
    }
    updateControls();
  }

  environment.addEventListener('change', () => {
    loadProfile();
    chrome.storage.local.set({hospitalizationEnvironment: environment.value})
      .catch(error => status('Не удалось сохранить контур. ' + error.message));
  });
  processId.addEventListener('input', () => {
    $('preparation').hidden = Boolean(processId.value.trim());
    updateControls();
  });

  function readDetails() {
    for (const [key, [title]] of Object.entries(caseFields)) {
      if (inputs[key].value.trim()) continue;
      $('employeeSettings').open = true;
      inputs[key].focus();
      throw new Error('Заполните поле «' + title + '».');
    }
    return Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]));
  }

  $('saveEmployee').addEventListener('click', async () => {
    if (!environment.value || saving) return;
    const contour = environment.value;
    try {
      const profile = readDetails();
      saving = true;
      updateControls();
      await chrome.storage.local.set({['hospitalizationProfile:' + contour]: profile});
      profiles[contour] = profile;
      if (environment.value === contour) status('Реквизиты сохранены для ' + contour + '.');
    } catch (error) {
      status(error.message);
    } finally {
      saving = false;
      updateControls();
    }
  });

  function showJob(value) {
    job = value;
    if (job) {
      $('hospitalization').open = true;
      status(job.message + '\n' + job.environment + ' · ' + job.target +
        (job.id ? '\nProcess ID · ' + job.id : ''));
      const rows = job.steps.map(({operation, result}) => {
        const row = document.createElement('details');
        const title = document.createElement('summary');
        const body = document.createElement('pre');
        title.textContent = operation;
        body.textContent = JSON.stringify(result, null, 2);
        row.append(title, body);
        return row;
      });
      $('steps').replaceChildren(...rows);
      $('trace').hidden = rows.length === 0;
    }
    updateControls();
  }

  function confirmHospitalization(target) {
    const dialog = $('confirmHospitalization');
    $('confirmationTarget').textContent = 'Госпитализировать в контуре ' + environment.value + '?\n' + target;
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {once: true});
    });
  }

  $('registrationForm').addEventListener('submit', async event => {
    event.preventDefault();
    if ($('submitRegistration').disabled) return;
    try {
      const details = readDetails();
      const draftId = processId.value.trim();
      const target = draftId || $('hospitalizationPatient').textContent;
      if (!await confirmHospitalization(target)) return;
      starting = true;
      updateControls();
      const response = await chrome.runtime.sendMessage({
        type: 'hospitalize', environment: environment.value, processId: draftId,
        workflow: $('workflow').value, details, patient
      });
      if (response?.error) status(response.error);
    } catch (error) {
      status(error.message);
    } finally {
      starting = false;
      updateControls();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.hospitalizationJob) showJob(changes.hospitalizationJob.newValue);
  });

  async function init() {
    try {
      const contours = Object.keys(environments);
      const [settings, session] = await Promise.all([
        chrome.storage.local.get(['hospitalizationEnvironment', ...contours.map(name => 'hospitalizationProfile:' + name)]),
        chrome.storage.session.get('hospitalizationJob')
      ]);
      profiles = Object.fromEntries(contours.map(name => [name, settings['hospitalizationProfile:' + name]]));
      environment.value = settings.hospitalizationEnvironment ?? '';
      if (!job && session.hospitalizationJob?.state === 'running') {
        const worker = await chrome.runtime.sendMessage({type: 'hospitalization-status'});
        if (!worker.running) {
          session.hospitalizationJob.state = 'error';
          session.hospitalizationJob.message = 'Запрос прерван. Проверьте результат перед повторной отправкой.';
        }
      }
      showJob(job ?? session.hospitalizationJob);
    } catch (error) {
      status('Не удалось загрузить настройки. ' + error.message);
    }
    initialized = true;
    loadProfile();
  }
  init();

  return {setPatient(value) {
    patient = value;
    $('hospitalizationPatient').textContent = [value.lastName, value.firstName, value.middleName].filter(Boolean).join(' ');
    updateControls();
  }};
})();
