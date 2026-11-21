'use strict';

importScripts('registration.js', 'autofill.js', 'triage.js');

let running = false;
const samotekRunning = new Set();
const triageRunning = new Set();

async function processSamotekJob(tabId) {
  if (samotekRunning.has(tabId)) return;
  const {samotekAutofillJob: job} = await chrome.storage.session.get('samotekAutofillJob');
  if (!job || job.tabId !== tabId || job.state !== 'waiting') return;
  let tab;
  try {tab = await chrome.tabs.get(tabId);} catch {return;}
  if (!tab.url?.startsWith('https://reg.dev.m99.dzm/samotek')) return;
  if (tab.status !== 'complete') return;
  samotekRunning.add(tabId);
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      const [{result}] = await chrome.scripting.executeScript({
        target:{tabId}, func:fillPatientForm, args:[job.patient, {}, job.replace]
      });
      const resolved = new Set(result?.filled || []);
      for (const value of result?.skipped || []) {
        const match = value.match(/^([^:]+): (?:уже заполнено|уже выбран)$/);
        if (match) resolved.add(match[1]);
      }
      const required = ['series','number','lastName','firstName','birthDate','snils','oms','sex'];
      const formFound = result && required.every(key => resolved.has(key));
      if (formFound) {
        job.state = 'done';job.report = result;job.message = 'Форма заполнена.';
        delete job.patient;
        await chrome.storage.session.set({samotekAutofillJob:job});
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Форма пациента не появилась в течение 10 секунд. Откройте её и нажмите «Автозаполнить открытую форму».');
  } catch (error) {
    job.state = 'error';job.message = error.message;delete job.patient;
    await chrome.storage.session.set({samotekAutofillJob:job});
  } finally {samotekRunning.delete(tabId);}
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || changeInfo.url) processSamotekJob(tabId).catch(() => {});
  if (changeInfo.status === 'complete' || changeInfo.url) processTriageJob(tabId).catch(() => {});
});

async function processTriageJob(tabId) {
  if (triageRunning.has(tabId)) return;
  const {triageJob:job} = await chrome.storage.session.get('triageJob');
  if (!job || job.tabId !== tabId || job.state !== 'waiting') return;
  let tab;try {tab = await chrome.tabs.get(tabId);} catch {return;}
  if (!tab.url?.startsWith('https://reg.dev.m99.dzm/')) return;
  if (tab.status !== 'complete') return;
  triageRunning.add(tabId);
  try {
    for (let attempt=0;attempt<120;attempt++) {
      try {
        const [{result}] = await chrome.scripting.executeScript({
          target:{tabId},func:PatientTriage.advanceTriage,args:[job.patient,job.values]
        });
        job.message = result?.message || 'Ожидание интерфейса триажа…';
        await chrome.storage.session.set({triageJob:job});
        if (result?.state === 'filled') {
          job.state='done';job.result=result;delete job.patient;
          await chrome.storage.session.set({triageJob:job});return;
        }
      } catch (error) {
        if (String(error.message).includes('другого пациента')) throw error;
      }
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    throw new Error('Пациент не найден или форма триажа не открылась в течение двух минут.');
  } catch (error) {
    job.state='error';job.message=error.message;delete job.patient;
    await chrome.storage.session.set({triageJob:job});
  } finally {triageRunning.delete(tabId);}
}

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
  if (message.type === 'open-and-autofill-samotek') {
    chrome.tabs.create({url:'https://reg.dev.m99.dzm/samotek'}).then(async tab => {
      await chrome.storage.session.set({samotekAutofillJob:{
        tabId:tab.id, patient:message.patient, replace:Boolean(message.replace),
        state:'waiting', startedAt:Date.now(), message:'Ожидание формы…'
      }});
      processSamotekJob(tab.id).catch(() => {});
      reply({tabId:tab.id});
    }, error => reply({error:error.message}));
    return true;
  }
  if (message.type === 'generate-triage') {
    chrome.tabs.create({url:'https://reg.dev.m99.dzm/medreg'}).then(async tab => {
      const job={tabId:tab.id,patient:message.patient,values:PatientTriage.createTriageValues(message.patient),
        state:'waiting',startedAt:Date.now(),message:'Ожидание списка ТРИАЖ…'};
      await chrome.storage.session.set({triageJob:job});processTriageJob(tab.id).catch(()=>{});reply({tabId:tab.id});
    },error=>reply({error:error.message}));
    return true;
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
