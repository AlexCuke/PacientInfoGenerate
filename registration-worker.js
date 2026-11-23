'use strict';

importScripts('registration.js', 'autofill.js', 'triage.js', 'keycloak.js', 'workflow.js', 'browser-environments.js');

let running = false;
const samotekRunning = new Set();
const triageRunning = new Set();
const completeWorkflowRunning = new Set();

const workflowDelay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function resolvedAutofillFields(result) {
  const resolved = new Set(result?.filled || []);
  for (const value of result?.skipped || []) {
    const match = value.match(/^([^:]+): (?:уже заполнено|уже выбран)$/);
    if (match) resolved.add(match[1]);
  }
  return resolved;
}

async function processCompleteWorkflowJob(tabId) {
  if (completeWorkflowRunning.has(tabId)) return;
  let {completeWorkflowJob:job} = await chrome.storage.session.get('completeWorkflowJob');
  if (!job || job.tabId !== tabId || !['waiting','running'].includes(job.state)) return;
  completeWorkflowRunning.add(tabId);
  const persist = () => chrome.storage.session.set({completeWorkflowJob:structuredClone(job)});
  try {
    const origin = BrowserEnvironments.originFor(job.environment);
    job.state='running';await persist();
    for (let attempt=0;attempt<300;attempt++) {
      const tab = await chrome.tabs.get(tabId);
      const url = new URL(tab.url || 'about:blank');
      if (url.origin === 'https://keycloak.dev.m99.dzm') {
        job.message='Выполняется вход через Keycloak…';await persist();
        if (tab.status === 'complete') await processKeycloakTab(tabId);
        await workflowDelay(1000);continue;
      }
      if (url.origin !== origin || tab.status !== 'complete') {
        job.message='Ожидание загрузки ' + (job.environment || 'M99 DEV') + ' или завершения входа…';
        await persist();await workflowDelay(1000);continue;
      }

      if (job.phase === 'registration') {
        if (!/^\/samotek(?:\/|$)/.test(url.pathname)) {
          await chrome.tabs.update(tabId,{url:origin + '/samotek'});await workflowDelay(1000);continue;
        }
        job.message='Заполняется карточка пациента…';await persist();
        const [{result:report}] = await chrome.scripting.executeScript({
          target:{tabId},func:fillPatientForm,args:[job.patient,{},true,origin]
        });
        const required=['documentType','series','number','issuer','issueDate','lastName','firstName','middleName','birthDate','snils','oms','sex'];
        const resolved=resolvedAutofillFields(report);
        const missing=required.filter(key=>!resolved.has(key));
        if (report?.errors?.length || missing.length) {
          job.message='Ожидание полного заполнения формы: '+[...(report?.errors||[]),...missing.map(key=>key+': не заполнено')].join('; ');
          await persist();await workflowDelay(700);continue;
        }
        const [{result:submitted}] = await chrome.scripting.executeScript({
          target:{tabId},func:PatientWorkflow.submitPatientRegistration,args:[origin]
        });
        job.message=submitted?.message||'Ожидание кнопки регистрации.';await persist();
        if (submitted?.state === 'submitted') {
          job.phase='registration-submitted';job.registrationSubmittedAt=Date.now();await persist();
        }
        await workflowDelay(1000);continue;
      }

      if (job.phase === 'registration-submitted') {
        if (/^\/(?:medreg|triage)(?:\/|$)/.test(url.pathname)) {
          job.phase='triage';job.message='Пациент зарегистрирован. Открывается список ТРИАЖ…';await persist();continue;
        }
        const [{result}] = await chrome.scripting.executeScript({target:{tabId},func:PatientWorkflow.inspectSubmission,args:['registration',origin]});
        if (result?.state === 'error') throw new Error('Регистрация не выполнена: '+result.message);
        if (result?.state === 'transitioned') {
          job.phase='triage';job.message=result.message;await persist();await workflowDelay(1000);continue;
        }
        if (result?.state === 'success') {
          job.phase='triage';job.message='Пациент зарегистрирован. Открывается список ТРИАЖ…';await persist();
          await chrome.tabs.update(tabId,{url:origin + '/medreg'});await workflowDelay(1000);continue;
        }
        if (Date.now()-job.registrationSubmittedAt>120000) throw new Error('Система не подтвердила регистрацию пациента в течение двух минут.');
        job.message=result?.message||'Ожидание регистрации пациента…';await persist();await workflowDelay(1000);continue;
      }

      if (job.phase === 'triage') {
        if (!/^\/(?:medreg|triage)(?:\/|$)/.test(url.pathname)) {
          await chrome.tabs.update(tabId,{url:origin + '/medreg'});await workflowDelay(1000);continue;
        }
        let result;
        try {
          [{result}] = await chrome.scripting.executeScript({
            target:{tabId},func:PatientTriage.advanceTriage,args:[job.patient,job.values,{submit:true},origin]
          });
        } catch (error) {
          if (String(error.message).includes('другого пациента')) throw error;
          job.message='Ожидание формы триажа: '+error.message;await persist();await workflowDelay(1000);continue;
        }
        job.message=result?.message||'Ищу пациента в списке ТРИАЖ…';await persist();
        if (result?.state === 'submitted') {
          job.phase='triage-submitted';job.triageSubmittedAt=Date.now();await persist();
        }
        await workflowDelay(1000);continue;
      }

      if (job.phase === 'triage-submitted') {
        if (/^\/medreg(?:\/|$)/.test(url.pathname)) {
          job.state='done';job.message='Пациент зарегистрирован и распределён после триажного осмотра.';job.finishedAt=Date.now();await persist();return;
        }
        const [{result}] = await chrome.scripting.executeScript({target:{tabId},func:PatientWorkflow.inspectSubmission,args:['triage',origin]});
        if (result?.state === 'error') throw new Error('Триаж не завершён: '+result.message);
        if (result?.state === 'success') {
          job.state='done';job.message='Пациент зарегистрирован и распределён после триажного осмотра.';job.finishedAt=Date.now();await persist();return;
        }
        if (Date.now()-job.triageSubmittedAt>120000) throw new Error('Система не подтвердила распределение пациента в течение двух минут.');
        job.message=result?.message||'Ожидание завершения триажа…';await persist();await workflowDelay(1000);continue;
      }
    }
    throw new Error('Полный сценарий не завершился в течение пяти минут.');
  } catch (error) {
    job.state='error';job.message=error.message;job.finishedAt=Date.now();await persist();
  } finally {completeWorkflowRunning.delete(tabId);}
}

async function processSamotekJob(tabId) {
  if (samotekRunning.has(tabId)) return;
  const {samotekAutofillJob: job} = await chrome.storage.session.get('samotekAutofillJob');
  if (!job || job.tabId !== tabId || job.state !== 'waiting') return;
  let tab;
  try {tab = await chrome.tabs.get(tabId);} catch {return;}
  const origin = BrowserEnvironments.originFor(job.environment);
  if (!BrowserEnvironments.isSamotek(tab.url, origin)) return;
  if (tab.status !== 'complete') return;
  samotekRunning.add(tabId);
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      const [{result}] = await chrome.scripting.executeScript({
        target:{tabId}, func:fillPatientForm, args:[job.patient, {}, job.replace, origin]
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
  if (changeInfo.status === 'complete' || changeInfo.url) processKeycloakTab(tabId).catch(() => {});
  if (changeInfo.status === 'complete' || changeInfo.url) processCompleteWorkflowJob(tabId).catch(() => {});
});

async function keycloakCredentials() {
  const [local,session]=await Promise.all([
    chrome.storage.local.get('keycloakSettings'),chrome.storage.session.get('keycloakSessionPassword')
  ]);
  const settings=local.keycloakSettings;
  if (!settings?.autoLogin) return null;
  return {...settings,password:settings.password||session.keycloakSessionPassword};
}

async function processKeycloakTab(tabId) {
  let tab;try{tab=await chrome.tabs.get(tabId);}catch{return;}
  if (tab.status!=='complete'||!tab.url?.startsWith('https://keycloak.dev.m99.dzm/')) return;
  const settings=await keycloakCredentials();
  if(!settings?.password){
    await chrome.storage.session.set({keycloakAuthStatus:{state:'credentials-missing',message:'Автовход включён, но пароль отсутствует.'}});return;
  }
  const attemptKey='keycloakLoginAttempt:'+tabId;
  const previous=(await chrome.storage.session.get(attemptKey))[attemptKey];
  if(previous?.url===tab.url)return;
  await chrome.storage.session.set({[attemptKey]:{url:tab.url,at:Date.now()}});
  try {
    const [{result}]=await chrome.scripting.executeScript({target:{tabId},func:KeycloakAutomation.keycloakAutoLogin,args:[settings]});
    const messages={
      'login-submitted':'Логин и пароль переданы в Keycloak.',
      'profile-selected':'Рабочий профиль выбран.',
      'credentials-missing':'Не заполнены логин или пароль.',
      'no-login-form':'Страница Keycloak открыта, но форма входа не распознана.'
    };
    await chrome.storage.session.set({keycloakAuthStatus:{state:result?.state||'unknown',message:messages[result?.state]||'Неизвестный ответ Keycloak.'}});
  } catch(error){
    await chrome.storage.session.set({keycloakAuthStatus:{state:'error',message:error.message}});throw error;
  }
}

async function processTriageJob(tabId) {
  if (triageRunning.has(tabId)) return;
  const {triageJob:job} = await chrome.storage.session.get('triageJob');
  if (!job || job.tabId !== tabId || job.state !== 'waiting') return;
  let tab;try {tab = await chrome.tabs.get(tabId);} catch {return;}
  const origin = BrowserEnvironments.originFor(job.environment);
  if (new URL(tab.url || 'about:blank').origin !== origin) return;
  if (tab.status !== 'complete') return;
  triageRunning.add(tabId);
  try {
    for (let attempt=0;attempt<120;attempt++) {
      try {
        const [{result}] = await chrome.scripting.executeScript({
          target:{tabId},func:PatientTriage.advanceTriage,args:[job.patient,job.values,null,origin]
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
    Promise.resolve().then(() => chrome.tabs.create({url:BrowserEnvironments.originFor(message.environment) + '/samotek'})).then(async tab => {
      await chrome.storage.session.set({samotekAutofillJob:{
        tabId:tab.id, patient:message.patient, replace:Boolean(message.replace), environment:message.environment,
        state:'waiting', startedAt:Date.now(), message:'Ожидание формы…'
      }});
      processSamotekJob(tab.id).catch(() => {});
      reply({tabId:tab.id});
    }).catch(error => reply({error:error.message}));
    return true;
  }
  if (message.type === 'generate-triage') {
    Promise.resolve().then(() => chrome.tabs.create({url:BrowserEnvironments.originFor(message.environment) + '/medreg'})).then(async tab => {
      const job={tabId:tab.id,patient:message.patient,values:PatientTriage.createTriageValues(message.patient),environment:message.environment,
        state:'waiting',startedAt:Date.now(),message:'Ожидание списка ТРИАЖ…'};
      await chrome.storage.session.set({triageJob:job});processTriageJob(tab.id).catch(()=>{});reply({tabId:tab.id});
    }).catch(error=>reply({error:error.message}));
    return true;
  }
  if (message.type === 'run-complete-workflow') {
    chrome.storage.session.get('completeWorkflowJob').then(async ({completeWorkflowJob}) => {
      if (completeWorkflowJob && ['waiting','running'].includes(completeWorkflowJob.state)) {
        reply({error:'Полный сценарий уже выполняется.'});return;
      }
      const tab=await chrome.tabs.create({url:BrowserEnvironments.originFor(message.environment) + '/samotek'});
      const job={tabId:tab.id,patient:message.patient,values:PatientTriage.createTriageValues(message.patient),environment:message.environment,
        phase:'registration',state:'waiting',startedAt:Date.now(),message:'Открывается регистрация пациента…'};
      await chrome.storage.session.set({completeWorkflowJob:job,currentPatient:message.patient});
      processCompleteWorkflowJob(tab.id).catch(()=>{});reply({tabId:tab.id});
    },error=>reply({error:error.message})).catch(error=>reply({error:error.message}));
    return true;
  }
  if (message.type === 'keycloak-settings-updated') {
    chrome.tabs.query({url:'https://keycloak.dev.m99.dzm/*'}).then(async tabs=>{
      await chrome.storage.session.remove(tabs.map(tab=>'keycloakLoginAttempt:'+tab.id));
      await Promise.all(tabs.map(tab=>processKeycloakTab(tab.id).catch(()=>{})));reply({});
    });
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
