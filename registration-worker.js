'use strict';

importScripts('registration.js');

let running = false;

async function hospitalize({environment, patient, processId, workflow, details}) {
  const target = processId || [patient?.lastName, patient?.firstName, patient?.middleName].filter(Boolean).join(' ');
  const {hospitalizationJob: previous} = await chrome.storage.session.get('hospitalizationJob');
  if (previous?.state === 'done' && previous.environment === environment &&
      (processId ? previous.id === processId : !previous.processId && previous.snils === patient?.snils)) {
    throw new Error('Этот случай уже зарегистрирован.');
  }
  const job = {environment, target, processId, snils: patient?.snils, steps: [], state: 'running', message: 'Запуск госпитализации…'};
  let lastOperation;
  const persist = () => chrome.storage.session.set({hospitalizationJob: structuredClone(job)});
  await persist();
  try {
    await PatientRegistration.register({environment, patient, processId, workflow, details, async onStep(step) {
      lastOperation = step.operation;
      job.id = step.id;
      job.message = 'Выполняется ' + step.operation + '…';
      if (step.result !== undefined) job.steps.push({operation: step.operation, result: step.result});
      await persist();
    }});
    job.state = 'done';
    job.message = 'Стационарный случай зарегистрирован.';
  } catch (error) {
    job.state = 'error';
    job.message = error.message;
    if (lastOperation === 'POST /register' && job.id) {
      job.message += '\nПеред повторной отправкой проверьте результат по Process ID.';
    }
  }
  await persist();
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'hospitalization-status') {
    reply({running});
    return;
  }
  if (message.type !== 'hospitalize') return;
  if (running) {
    reply({error: 'Госпитализация уже выполняется.'});
    return;
  }
  running = true;
  hospitalize(message)
    .then(() => reply({}), error => reply({error: error.message}))
    .finally(() => { running = false; });
  return true;
});
