    (() => {
      "use strict";
      const STORAGE_KEY = "mjkCloserLeads.v1";
      const APP_STATE_KEY = "mjkSalesTools.v2";
      const CALCULATOR_STORAGE_KEY = "mjkCalculator.v1";
      const FIREBASE_CONFIG_KEY = "mjkCloud.firebaseConfig.v1";
      const CLOUD_SYNC_META_KEY = "mjkCloud.syncMetadata.v1";
      const SIGNUP_COMPANY_ID = "mjk_company";
      const PRIMARY_ADMIN_EMAIL = "";
      const EMPLOYEE_ALLOWED_TABS = new Set(["crm", "scheduler", "scripts", "actions"]);
      const DEFAULT_FIREBASE_CONFIG = Object.freeze({
        apiKey: "AIzaSyB7f3lqbicC9M3aUC5HWd4ackTQc3fGJ64",
        authDomain: "mjk-sales.firebaseapp.com",
        projectId: "mjk-sales",
        storageBucket: "mjk-sales.firebasestorage.app",
        messagingSenderId: "1079020522128",
        appId: "1:1079020522128:web:66fbf6ccb52f5f366be615",
        measurementId: "G-4D3P2VSRDZ"
      });
      const byId = id => document.getElementById(id);
      const money = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 });
      const integer = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 });
      let leads = loadLeads();6
      let cleanedContacts = [];
      let toastTimer;
      let leadDateResolver = null;
      let appState = loadAppState();
      cleanedContacts = appState.cleanerRows;
      let ocrWorkerPromise = null;
      let cloudApp = null;
      let cloudAuth = null;
      let cloudFunctions = null;
      let cloudDb = null;
      let cloudUser = null;
      let cloudAccountMismatch = false;
      let cloudListener = null;
      let companyLeadsListener = null;
      let teamProfilesListener = null;
      let companySettingsListener = null;
      let userProfileListener = null;
      let userManagementListener = null;
      let leadHistoryListener = null;
      let activeSession = { uid: "", email: "", role: "", companyId: "", authType: "", ready: false };
      let teamProfiles = [];
      let managedUsers = [];
      let initialManagedUsersSnapshot = true;
      let alertAudioContext = null;
      let alertInterval = 0;
      let activeAlertKey = "";
      const alertedRegistrationIds = new Set();
      let signupMode = false;
      let signupInProgress = false;
      let authSessionGeneration = 0;
      const defaultCompanySettings = {
        features: { whatsapp: true, metaLeadAds: false, voip: false, invoicing: false, emailAutomation: false, advancedAnalytics: false },
        whatsappTemplate: "Ù…Ø±Ø­Ø¨Ù‹Ø§ {name}ØŒ Ù…Ø¹Ùƒ ÙØ±ÙŠÙ‚ MJK Ø¨Ø®ØµÙˆØµ {project}.",
        emailSubject: "ØªÙØ§ØµÙŠÙ„ Ù…Ø´Ø±ÙˆØ¹ {project}",
        emailTemplate: "Ù…Ø±Ø­Ø¨Ù‹Ø§ {name}ØŒ\nÙŠØ³Ø¹Ø¯Ù†Ø§ ØªÙˆØ§ØµÙ„Ùƒ Ù…Ø¹Ù†Ø§ Ø¨Ø®ØµÙˆØµ {project}.",
        metaWebhookUrl: "",
        metaFieldMapping: { name: "full_name", phone: "phone_number", email: "email", company: "company_name", jobTitle: "job_title", location: "city" }
      };
      let companySettings = JSON.parse(JSON.stringify(defaultCompanySettings));
      let metaPreviewLead = null;
      let activePipeline = "rejected";
      let companyLeadCacheKey = "";
      let companyInitialServerSnapshot = false;
      let companyLeadRecords = new Map();
      const pendingCompanyLeadIds = new Set();
      const writingCompanyLeadIds = new Set();
      const companyLeadWriteQueues = new Map();
      const pendingCompanyActionIds = new Set();
      let pendingLegacyLeadMigration = [];
      let legacyCloudLeadRecords = new Map();
      let companyActions = [];
      let cloudInitPromise = null;
      let cloudApplyingRemote = false;
      let cloudSyncInProgress = false;
      let cloudInitialServerSnapshot = false;
      let cloudMergeQueue = Promise.resolve();
      const cloudQueuedKeys = new Set();
      const cloudWritingKeys = new Set();
      let cloudLastError = "";
      let cloudRemoteRecords = new Map();
      let cloudSyncMetadata = loadCloudSyncMetadata();
      let lastLocalRecords = new Map();
      let calculatorSchedule = [];
      let calculatorUserChanged = false;
      let reminderTimer = 0;
      const firedReminders = new Set();

      const defaultScripts = [
        { id: "seed-price", title: "Ø§Ø¹ØªØ±Ø§Ø¶ Ø§Ù„Ø³Ø¹Ø±", category: "Ø§Ù„Ø³Ø¹Ø± ÙˆØ§Ù„Ù…ÙŠØ²Ø§Ù†ÙŠØ©", text: "Ù…ØªÙÙ‡Ù… ØªÙ…Ø§Ù…Ù‹Ø§ Ø¥Ù† Ø§Ù„Ø³Ø¹Ø± Ø¹Ø§Ù…Ù„ Ù…Ù‡Ù…. Ø®Ù„ÙŠÙ†Ø§ Ù†Ù‚Ø§Ø±Ù† Ø§Ù„Ù‚ÙŠÙ…Ø© Ø§Ù„ÙØ¹Ù„ÙŠØ©: Ø§Ù„Ù…ÙˆÙ‚Ø¹ØŒ Ø®Ø·Ø© Ø§Ù„Ø³Ø¯Ø§Ø¯ØŒ ÙˆØ§Ù„Ø®Ø¯Ù…Ø§Øª. Ø¥ÙŠÙ‡ Ø§Ù„Ù†Ø·Ø§Ù‚ Ø§Ù„Ù„ÙŠ ÙŠÙ†Ø§Ø³Ø¨ Ù…ÙŠØ²Ø§Ù†ÙŠØªÙƒ Ø¹Ø´Ø§Ù† Ø£Ø±Ø§Ø¬Ø¹ Ù„Ùƒ Ø£ÙØ¶Ù„ Ø§Ø®ØªÙŠØ§Ø±ØŸ" },
        { id: "seed-timing", title: "Ù…Ø­ØªØ§Ø¬ Ø£ÙÙƒØ±", category: "Ø§Ù„ØªÙˆÙ‚ÙŠØª ÙˆØ§Ù„ØªØ±Ø¯Ø¯", text: "Ø£ÙƒÙŠØ¯ØŒ Ø§Ù„Ù‚Ø±Ø§Ø± Ù…Ø­ØªØ§Ø¬ Ø±Ø§Ø­Ø©. Ø¹Ø´Ø§Ù† Ø£Ø³Ø§Ø¹Ø¯Ùƒ Ø¨Ù…Ø¹Ù„ÙˆÙ…Ø© Ù…Ø­Ø¯Ø¯Ø©: Ø¥ÙŠÙ‡ Ø£ÙƒØªØ± Ù†Ù‚Ø·Ø© Ù„Ø³Ù‡ Ù…Ø­ØªØ§Ø¬Ø© ØªÙˆØ¶ÙŠØ­ Ù‚Ø¨Ù„ Ù…Ø§ ØªÙ‚Ø±Ø±ØŸ" },
        { id: "seed-compare", title: "Ø¨Ø´ÙˆÙ Ù…Ø´Ø±ÙˆØ¹ ØªØ§Ù†ÙŠ", category: "Ø§Ù„Ù…Ù‚Ø§Ø±Ù†Ø© ÙˆØ§Ù„Ù…Ù†Ø§ÙØ³Ø©", text: "Ù…Ù…ØªØ§Ø² Ø¥Ù†Ùƒ Ø¨ØªÙ‚Ø§Ø±Ù†. Ù†Ù‚Ø¯Ø± Ù†Ø¹Ù…Ù„ Ù…Ù‚Ø§Ø±Ù†Ø© Ù…ÙˆØ¶ÙˆØ¹ÙŠØ© Ø¨ÙŠÙ† Ø§Ù„Ù…ÙˆÙ‚Ø¹ØŒ Ù…ÙˆØ¹Ø¯ Ø§Ù„ØªØ³Ù„ÙŠÙ…ØŒ Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„ØªÙƒÙ„ÙØ© ÙˆØ®Ø·Ø© Ø§Ù„Ø³Ø¯Ø§Ø¯. Ø¥ÙŠÙ‡ Ø£Ù‡Ù… Ù…Ø¹ÙŠØ§Ø± Ø¹Ù†Ø¯ÙƒØŸ" },
        { id: "seed-followup", title: "Ù…ØªØ§Ø¨Ø¹Ø© Ø¨Ø¹Ø¯ Ø¥Ø±Ø³Ø§Ù„ Ø§Ù„ØªÙØ§ØµÙŠÙ„", category: "Ø±Ø³Ø§Ù„Ø© Ù…ØªØ§Ø¨Ø¹Ø©", text: "Ø£Ù‡Ù„Ù‹Ø§ Ø£/ [Ø§Ù„Ø§Ø³Ù…]ØŒ Ø­Ø¨ÙŠØª Ø£ØªØ£ÙƒØ¯ Ø¥Ù† ØªÙØ§ØµÙŠÙ„ [Ø§Ù„Ù…Ø´Ø±ÙˆØ¹] ÙˆØµÙ„ØªÙƒ. Ù„Ùˆ ØªØ­Ø¨ØŒ Ø£Ø±ØªØ¨ Ù„Ùƒ Ù…Ø¹Ø§ÙŠÙ†Ø© Ø£Ùˆ Ø£Ø¬Ø§ÙˆØ¨ Ø¹Ù„Ù‰ Ø£ÙŠ Ù†Ù‚Ø·Ø© Ù‚Ø¨Ù„ Ø§Ù„Ø®Ø·ÙˆØ© Ø§Ù„ØªØ§Ù„ÙŠØ©." },
        { id: "seed-close", title: "ØªØ£ÙƒÙŠØ¯ Ø§Ù„Ø®Ø·ÙˆØ© Ø§Ù„ØªØ§Ù„ÙŠØ©", category: "Ø¥ØºÙ„Ø§Ù‚ Ø§Ù„Ø¨ÙŠØ¹", text: "Ù„Ùˆ Ø§Ù„ÙˆØ­Ø¯Ø© ÙˆØ§Ù„Ù…ÙˆØ§Ø¹ÙŠØ¯ Ù…Ù†Ø§Ø³Ø¨ÙŠÙ† Ù„ÙƒØŒ Ù†Ø±Ø§Ø¬Ø¹ Ù…Ø¹Ù‹Ø§ Ø®Ø·ÙˆØ§Øª Ø§Ù„Ø­Ø¬Ø² ÙˆØ§Ù„Ù…Ø³ØªÙ†Ø¯Ø§Øª ÙˆØ§Ù„Ù…Ø¨Ø§Ù„Øº ÙƒØªØ§Ø¨Ø©Ù‹ Ù‚Ø¨Ù„ Ø£ÙŠ Ø§Ù„ØªØ²Ø§Ù…. ØªØ­Ø¨ Ù†Ø­Ø¯Ø¯ ÙˆÙ‚Øª Ù„Ù„Ù…Ø±Ø§Ø¬Ø¹Ø©ØŸ" }
      ];

      function loadAppState() {
        const defaults = { lookups: [], appointments: [], customScripts: [], archive: [], projectKnowledge: [], crmBatches: [], cleanerBatchRuns: 0, cleanerRows: [] };
        try {
          const saved = localStorage.getItem(APP_STATE_KEY);
          if (!saved) return defaults;
          const parsed = JSON.parse(saved);
          return {
            ...defaults,
            ...parsed,
            lookups: Array.isArray(parsed.lookups) ? parsed.lookups : [],
            appointments: Array.isArray(parsed.appointments) ? parsed.appointments : [],
            customScripts: Array.isArray(parsed.customScripts) ? parsed.customScripts : [],
            archive: Array.isArray(parsed.archive) ? parsed.archive : [],
            projectKnowledge: Array.isArray(parsed.projectKnowledge) ? parsed.projectKnowledge : [],
            crmBatches: Array.isArray(parsed.crmBatches) ? parsed.crmBatches : [],
            cleanerBatchRuns: Number.isFinite(parsed.cleanerBatchRuns) ? parsed.cleanerBatchRuns : 0,
            cleanerRows: Array.isArray(parsed.cleanerRows) ? parsed.cleanerRows : []
          };
        } catch (error) {
          console.error("Could not load MJK sales tools state:", error);
          return defaults;
        }
      }

      const cloudCollections = ["lookups", "appointments", "customScripts", "archive", "projectKnowledge", "crmBatches"];
      function defaultAppState() {
        return { lookups: [], appointments: [], customScripts: [], archive: [], projectKnowledge: [], crmBatches: [], cleanerBatchRuns: 0, cleanerRows: [] };
      }
      function companyLeadsPath() {
        if (!activeSession.companyId) throw new Error("Ù…Ù„Ù Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… Ù„Ø§ ÙŠØ­ØªÙˆÙŠ Ø¹Ù„Ù‰ companyId.");
        return cloudDb.collection("companies").doc(activeSession.companyId).collection("leads");
      }
      function companyLeadStorageKey(uid = activeSession.uid, companyId = activeSession.companyId) {
        return `mjkCloserLeads.company.${encodeURIComponent(companyId)}.${encodeURIComponent(uid)}`;
      }
      function companySettingsPath(companyId = activeSession.companyId) {
        if (!companyId) throw new Error("Ù…Ù„Ù Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… Ù„Ø§ ÙŠØ­ØªÙˆÙŠ Ø¹Ù„Ù‰ companyId.");
        return cloudDb.collection("companies").doc(companyId).collection("companySettings").doc("features");
      }
      function companySettingsStorageKey(companyId = activeSession.companyId) {
        return `mjkSales.companySettings.${encodeURIComponent(companyId)}`;
      }
      function companySettingsPendingKey(companyId = activeSession.companyId) {
        return `${companySettingsStorageKey(companyId)}.pending`;
      }
      function normalizeCompanySettings(value = {}) {
        const featureValues = value.features && typeof value.features === "object" ? value.features : {};
        return {
          ...defaultCompanySettings,
          ...value,
          features: Object.fromEntries(Object.entries(defaultCompanySettings.features)
            .map(([key, defaultValue]) => [key, typeof featureValues[key] === "boolean" ? featureValues[key] : defaultValue])),
          whatsappTemplate: typeof value.whatsappTemplate === "string" ? value.whatsappTemplate : defaultCompanySettings.whatsappTemplate,
          emailSubject: typeof value.emailSubject === "string" ? value.emailSubject : defaultCompanySettings.emailSubject,
          emailTemplate: typeof value.emailTemplate === "string" ? value.emailTemplate : defaultCompanySettings.emailTemplate,
          metaWebhookUrl: typeof value.metaWebhookUrl === "string" ? value.metaWebhookUrl : "",
          metaFieldMapping: value.metaFieldMapping && typeof value.metaFieldMapping === "object"
            ? value.metaFieldMapping : { ...defaultCompanySettings.metaFieldMapping }
        };
      }
      function featureEnabled(name) {
        return companySettings.features[name] === true;
      }
      function renderCompanyModules() {
        const moduleDefinitions = [
          ["whatsapp", "ÙˆØ§ØªØ³Ø§Ø¨ Ø³Ø±ÙŠØ¹ ÙˆÙ‚ÙˆØ§Ù„Ø¨ Ø§Ù„Ø±Ø³Ø§Ø¦Ù„", "ÙØªØ­ Ø¯Ø±Ø¯Ø´Ø© Ù…Ø¨Ø§Ø´Ø±Ø© Ø¨Ù‚Ø§Ù„Ø¨ Ø§Ù„Ø´Ø±ÙƒØ© Ù…Ø¹ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø¹Ù…ÙŠÙ„."],
          ["metaLeadAds", "Ù…Ø²Ø§Ù…Ù†Ø© Meta Lead Ads", "Ù…Ø¹Ø§ÙŠÙ†Ø© Ø®Ø±ÙŠØ·Ø© Ø§Ù„Ø­Ù‚ÙˆÙ„ ÙˆØ§Ø³ØªÙŠØ±Ø§Ø¯ Ø¹ÙŠÙ†Ø§Øª leadsØ› Ø§Ø³ØªÙ‚Ø¨Ø§Ù„ webhooks ÙŠØ­ØªØ§Ø¬ backend."],
          ["voip", "Ø§ØªØµØ§Ù„ VoIP ÙˆØ³Ø¬Ù„ Ø§Ù„Ù…ÙƒØ§Ù„Ù…Ø§Øª", "Ø¨Ø¯Ø¡ Ø§ØªØµØ§Ù„ Ø¹Ø¨Ø± ØªØ·Ø¨ÙŠÙ‚ Ø§Ù„Ù‡Ø§ØªÙ ÙˆØªØ³Ø¬ÙŠÙ„ Ù…Ø­Ø§ÙˆÙ„Ø© Ø§Ù„Ø§ØªØµØ§Ù„Ø› Ø§Ù„ØªØ³Ø¬ÙŠÙ„ Ø§Ù„ØµÙˆØªÙŠ ÙŠØ­ØªØ§Ø¬ Ù…Ø²ÙˆØ¯Ù‹Ø§ Ø®Ø§Ø±Ø¬ÙŠÙ‹Ø§."],
          ["invoicing", "Ø§Ù„ÙÙˆØ§ØªÙŠØ± ÙˆØ¹Ø±ÙˆØ¶ Ø§Ù„Ø£Ø³Ø¹Ø§Ø±", "Ø¥Ù†Ø´Ø§Ø¡ Ø¹Ø±Ø¶ Ø³Ø¹Ø±ØŒ Ø­ÙØ¸Ù‡ ÙÙŠ Ø§Ù„Ø¹Ù…ÙŠÙ„ØŒ ÙˆØ§Ù„Ø·Ø¨Ø§Ø¹Ø© Ø£Ùˆ Ø§Ù„Ø­ÙØ¸ PDF."],
          ["emailAutomation", "Ù‚ÙˆØ§Ù„Ø¨ Ø§Ù„Ø¨Ø±ÙŠØ¯ ÙˆØ§Ù„Ø£ØªÙ…ØªØ©", "ÙØªØ­ Ø±Ø³Ø§Ù„Ø© Ø¨Ø±ÙŠØ¯ Ø¬Ø§Ù‡Ø²Ø© Ù…Ù† Ù‚Ø§Ù„Ø¨ Ø§Ù„Ø´Ø±ÙƒØ©Ø› Ø¥Ø±Ø³Ø§Ù„ workflow Ø¢Ù„ÙŠ ÙŠØ­ØªØ§Ø¬ Ø®Ø¯Ù…Ø© Ø¨Ø±ÙŠØ¯ Ø®Ù„ÙÙŠØ©."],
          ["advancedAnalytics", "Ø§Ù„ØªØ­Ù„ÙŠÙ„Ø§Øª Ø§Ù„Ù…ØªÙ‚Ø¯Ù…Ø© ÙˆØ§Ù„Ø¹Ø§Ø¦Ø¯ ROI", "Ø¥Ø¸Ù‡Ø§Ø± Ù…Ø¤Ø´Ø±Ø§Øª Ø§Ù„Ø¹Ù…ÙˆÙ„Ø© ÙˆØ§Ù„ØªØ­ÙˆÙŠÙ„ Ø§Ù„ØªÙ‚Ø¯ÙŠØ±ÙŠØ© Ù„Ù„Ø´Ø±ÙƒØ©."]
        ];
        byId("company-module-list").innerHTML = moduleDefinitions.map(([key, title, description]) => {
          const enabled = featureEnabled(key);
          return `<article class="module-card"><div><h4>${title}</h4><p>${description}</p><span class="module-state ${enabled ? "is-on" : ""}">${enabled ? "Ù…ÙØ¹Ù‘Ù„" : "Ù…Ø¹Ø·Ù‘Ù„ Ù…Ù† Ø§Ù„Ø¥Ø¯Ø§Ø±Ø©"}</span></div>
            <label class="module-switch"><span>${enabled ? "ON" : "OFF"}</span><input type="checkbox" data-company-feature="${key}" ${enabled ? "checked" : ""} aria-label="${title}"></label></article>`;
        }).join("");
        byId("module-settings-status").textContent = activeSession.ready
          ? `Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ø´Ø±ÙƒØ© Â· ${activeSession.companyId}` : "Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ù…Ø­Ù„ÙŠØ© Â· Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù„Ù„Ø­ÙØ¸ Ø§Ù„Ø³Ø­Ø§Ø¨ÙŠ";
        byId("module-whatsapp-template").value = companySettings.whatsappTemplate;
        byId("module-email-subject").value = companySettings.emailSubject;
        byId("module-email-template").value = companySettings.emailTemplate;
        byId("meta-webhook-url").value = companySettings.metaWebhookUrl;
        byId("meta-field-mapping").value = JSON.stringify(companySettings.metaFieldMapping, null, 2);
        byId("module-roi-card").hidden = !featureEnabled("advancedAnalytics");
        if (!byId("module-roi-card").hidden) renderModuleRoi();
        byId("import-meta-sample").hidden = !featureEnabled("metaLeadAds") || !metaPreviewLead;
        renderLeads();
      }
      function renderModuleRoi() {
        const scopedLeads = leads.filter(canViewLead);
        const commission = scopedLeads.reduce((total, lead) => total + (Number(lead.expectedCommission) || 0), 0);
        const won = scopedLeads.filter(lead => lead.completed || lead.status === "won");
        const wonCommission = won.reduce((total, lead) => total + (Number(lead.expectedCommission) || 0), 0);
        byId("module-roi-summary").innerHTML = [
          ["Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡", scopedLeads.length], ["Ø§Ù„ØµÙÙ‚Ø§Øª Ø§Ù„Ù…ØºÙ„Ù‚Ø©", won.length],
          ["Ø§Ù„Ø¹Ù…ÙˆÙ„Ø§Øª Ø§Ù„Ù…ØªÙˆÙ‚Ø¹Ø©", money.format(commission)], ["Ø¹Ù…ÙˆÙ„Ø§Øª Ø§Ù„ØµÙÙ‚Ø§Øª", money.format(wonCommission)]
        ].map(([label, value]) => `<article class="summary-card"><span class="summary-label">${label}</span><strong class="summary-value">${value}</strong></article>`).join("");
      }
      async function saveCompanySettings(patch) {
        if (cloudUser && (!activeSession.ready || activeSession.role !== "admin")) {
          showToast("ØªØ¹Ø¯ÙŠÙ„ ÙˆØ­Ø¯Ø§Øª Ø§Ù„Ø´Ø±ÙƒØ© Ù…ØªØ§Ø­ Ù„Ù…Ø¯ÙŠØ± Ø§Ù„Ø´Ø±ÙƒØ© ÙÙ‚Ø·.");
          return false;
        }
        const previous = JSON.parse(JSON.stringify(companySettings));
        companySettings = normalizeCompanySettings({ ...companySettings, ...patch,
          features: { ...companySettings.features, ...(patch.features || {}) } });
        try {
          localStorage.setItem(companySettingsStorageKey(), JSON.stringify(companySettings));
        } catch (error) {
          companySettings = previous;
          renderCompanyModules();
          console.error("Could not save company module settings locally:", error);
          showToast("ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„ÙˆØ­Ø¯Ø§Øª Ù…Ø­Ù„ÙŠÙ‹Ø§Ø› Ù„Ù… ÙŠØªÙ… ØªØ·Ø¨ÙŠÙ‚ Ø§Ù„ØªØºÙŠÙŠØ±.");
          return false;
        }
        renderCompanyModules();
        if (!activeSession.ready || !cloudDb) return true;
        if (!navigator.onLine) {
          try {
            localStorage.setItem(companySettingsPendingKey(), "true");
            showToast("Ø­ÙÙØ¸Øª Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„ÙˆØ­Ø¯Ø§Øª Ù…Ø­Ù„ÙŠÙ‹Ø§Ø› Ø³ØªØªÙ… Ù…Ø²Ø§Ù…Ù†ØªÙ‡Ø§ Ø¹Ù†Ø¯ Ø¹ÙˆØ¯Ø© Ø§Ù„Ø§ØªØµØ§Ù„.");
          } catch (error) {
            console.error("Could not queue offline company settings:", error);
            showToast("Ø­ÙÙØ¸Øª Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø¹Ù„Ù‰ Ù‡Ø°Ø§ Ø§Ù„Ø¬Ù‡Ø§Ø²ØŒ Ù„ÙƒÙ† ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø·Ø§Ø¨ÙˆØ± Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø©.");
          }
          return true;
        }
        try {
          await companySettingsPath().set(companySettings, { merge: true });
          localStorage.removeItem(companySettingsPendingKey());
        } catch (error) {
          try { localStorage.setItem(companySettingsPendingKey(), "true"); }
          catch (storageError) { console.error("Could not queue pending company settings:", storageError); }
          console.error("Could not save company feature settings:", error);
          byId("module-settings-status").textContent = "Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ù…Ø­Ù„ÙŠØ© Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø©";
          showToast(`Ø­ÙÙØ¸Øª Ù…Ø­Ù„ÙŠÙ‹Ø§ØŒ Ù„ÙƒÙ† ØªØ¹Ø°Ø± Ù…Ø²Ø§Ù…Ù†Ø© Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„ÙˆØ­Ø¯Ø§Øª: ${error.message || error.code}.`);
        }
        return true;
      }
      async function flushPendingCompanySettings() {
        if (!activeSession.ready || !cloudDb || !navigator.onLine ||
            localStorage.getItem(companySettingsPendingKey()) !== "true") return;
        try {
          await companySettingsPath().set(companySettings, { merge: true });
          localStorage.removeItem(companySettingsPendingKey());
          byId("module-settings-status").textContent = `Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ø´Ø±ÙƒØ© Â· ${activeSession.companyId}`;
        } catch (error) {
          console.error("Could not sync pending company settings:", error);
          showToast(`ØªØ¹Ø°Ø± Ù…Ø²Ø§Ù…Ù†Ø© Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„ÙˆØ­Ø¯Ø§Øª Ø§Ù„Ù…Ø¹Ù„Ù‚Ø©: ${error.message || error.code}.`);
        }
      }
      function persistCompanyPendingQueue() {
        if (!companyLeadCacheKey) return;
        try {
          localStorage.setItem(`${companyLeadCacheKey}.pending`, JSON.stringify({
            leads: [...pendingCompanyLeadIds], actions: [...pendingCompanyActionIds]
          }));
        } catch (error) {
          console.error("Could not save the company synchronization queue:", error);
          showToast("ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø·Ø§Ø¨ÙˆØ± Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø© Ù…Ø­Ù„ÙŠÙ‹Ø§Ø› ØµØ¯Ù‘Ø± Ù†Ø³Ø®Ø© Ø§Ø­ØªÙŠØ§Ø·ÙŠØ©.");
        }
      }
      function canViewLead(lead) {
        if (!cloudUser) return true;
        if (!activeSession.ready) return false;
        if (activeSession.role === "admin") return !lead.companyId || lead.companyId === activeSession.companyId;
        const assigned = [activeSession.uid];
        if (activeSession.authType !== "shared-company-email" && activeSession.email) assigned.push(activeSession.email);
        return lead.companyId === activeSession.companyId && assigned.includes(lead.assignedTo);
      }
      function canModifyLead(lead) {
        if (!cloudUser) return true;
        return activeSession.ready && (activeSession.role === "admin" ||
          (activeSession.role === "agent" && lead.companyId === activeSession.companyId &&
            [activeSession.uid, ...(activeSession.authType === "shared-company-email" ? [] : [activeSession.email])]
              .filter(Boolean).includes(lead.assignedTo)));
      }
      function showApprovalScreen(profile, message = "") {
        const pending = profile?.status === "pending" || profile?.role === "pending";
        byId("app-shell").hidden = true;
        byId("approval-screen").classList.add("is-visible");
        byId("approval-icon").textContent = pending ? "â³" : "ðŸ”’";
        byId("approval-title").textContent = pending ? "Ø­Ø³Ø§Ø¨Ùƒ Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ù…ÙˆØ§ÙÙ‚Ø© Ø§Ù„Ø¥Ø¯Ø§Ø±Ø©" : "Ø§Ù„Ø­Ø³Ø§Ø¨ ØºÙŠØ± Ù…ÙØ¹Ù‘Ù„";
        byId("approval-message").textContent = message || (pending
          ? "ØªÙ… Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„Ø­Ø³Ø§Ø¨ Ø¨Ù†Ø¬Ø§Ø­. Ø³ØªØªÙ…ÙƒÙ† Ù…Ù† Ø¯Ø®ÙˆÙ„ Ù…Ø³Ø§Ø­Ø© Ø§Ù„Ø¹Ù…Ù„ Ø¨Ø¹Ø¯ Ø§Ø¹ØªÙ…Ø§Ø¯ Ø­Ø³Ø§Ø¨Ùƒ Ù…Ù† Ù…Ø¯ÙŠØ± Ø§Ù„Ø´Ø±ÙƒØ©."
          : "Ù„Ø§ ÙŠÙ…ÙƒÙ† Ù„Ù‡Ø°Ø§ Ø§Ù„Ø­Ø³Ø§Ø¨ Ø¯Ø®ÙˆÙ„ Ù…Ø³Ø§Ø­Ø© Ø§Ù„Ø¹Ù…Ù„. ØªÙˆØ§ØµÙ„ Ù…Ø¹ Ù…Ø¯ÙŠØ± Ø§Ù„Ø´Ø±ÙƒØ© Ù„Ù„Ù…Ø³Ø§Ø¹Ø¯Ø©.");
        byId("approval-email").textContent = activeSession.email || cloudUser?.email || "";
      }
      function hideApprovalScreen() {
        byId("approval-screen").classList.remove("is-visible");
        byId("app-shell").hidden = false;
      }
      function stopCompanySessionListeners() {
        [cloudListener, companyLeadsListener, teamProfilesListener, companySettingsListener, userManagementListener, leadHistoryListener]
          .forEach(unsubscribe => { if (unsubscribe) unsubscribe(); });
        cloudListener = null;
        companyLeadsListener = null;
        teamProfilesListener = null;
        companySettingsListener = null;
        userManagementListener = null;
        leadHistoryListener = null;
      }
      function blockCompanySession(profile, message) {
        stopCompanySessionListeners();
        activeSession = {
          uid: cloudUser?.uid || "", email: profile?.email || cloudUser?.email || "",
          role: profile?.role || "", companyId: profile?.companyId || "",
          authType: profile?.authType || "", ready: false
        };
        teamProfiles = [];
        managedUsers = [];
        companyActions = [];
        leads = [];
        companyLeadRecords.clear();
        companySettings = normalizeCompanySettings();
        refreshSessionUi();
        showApprovalScreen(profile, message);
      }
      function renderManagedUsers() {
        const pending = managedUsers.filter(profile => profile.status === "pending" || profile.role === "pending");
        const active = managedUsers.filter(profile => ["active", "approved"].includes(profile.status || "active") && ["agent", "admin"].includes(profile.role));
        const blocked = managedUsers.filter(profile => ["disabled", "rejected"].includes(profile.status));
        const renderIdentity = profile => `<div class="managed-user-head"><div><div class="managed-user-name">${escapeHTML(profile.fullName || "Ø¨Ø¯ÙˆÙ† Ø§Ø³Ù…")}</div>
          <div class="managed-user-meta">${escapeHTML(profile.email || profile.uid || "")}</div></div>
          <span class="role-badge">${escapeHTML(profile.status || "active")}</span></div>`;
        byId("pending-user-list").innerHTML = pending.map(profile => `<article class="managed-user" data-managed-user="${escapeHTML(profile.uid)}">
          ${renderIdentity(profile)}<div class="managed-user-actions"><label class="sr-only" for="approve-role-${escapeHTML(profile.uid)}">Ø§Ù„Ø¯ÙˆØ± Ø¹Ù†Ø¯ Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø©</label>
          <select class="control" id="approve-role-${escapeHTML(profile.uid)}" data-user-role><option value="agent">Ù…ÙˆØ¸Ù</option><option value="admin">Ù…Ø¯ÙŠØ±</option></select>
          <div class="btn-row"><button class="btn btn-quiet small-btn" type="button" data-assign-preset="100">Ù¡Ù Ù </button><button class="btn btn-quiet small-btn" type="button" data-assign-preset="500">Ù¥Ù Ù </button><button class="btn btn-quiet small-btn" type="button" data-assign-preset="2000">Ù¢Ù Ù Ù </button></div>
          <label for="assign-count-${escapeHTML(profile.uid)}">Ø¬Ù‡Ø§Øª Ø§ØªØµØ§Ù„ Ù…Ø®ØµØµØ© (0â€“2000)</label><input class="control" id="assign-count-${escapeHTML(profile.uid)}" data-assign-count type="number" min="0" max="2000" step="1" value="0">
          <button class="btn btn-primary small-btn" type="button" data-user-action="approve">Ù…ÙˆØ§ÙÙ‚Ø© ÙˆØªÙØ¹ÙŠÙ„</button>
          <button class="btn btn-danger small-btn" type="button" data-user-action="reject">Ø±ÙØ¶ / Ø­Ø¸Ø±</button></div></article>`).join("");
        byId("active-user-list").innerHTML = active.map(profile => `<article class="managed-user" data-managed-user="${escapeHTML(profile.uid)}">
          ${renderIdentity(profile)}<div class="managed-user-actions"><label class="sr-only" for="active-role-${escapeHTML(profile.uid)}">ØªØºÙŠÙŠØ± Ø¯ÙˆØ± Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…</label>
          <select class="control" id="active-role-${escapeHTML(profile.uid)}" data-user-role ${profile.uid === activeSession.uid || (profile.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL && profile.authType !== "shared-company-email") ? "disabled" : ""}>
            <option value="agent" ${profile.role === "agent" ? "selected" : ""}>Ù…ÙˆØ¸Ù</option>
            <option value="admin" ${profile.role === "admin" ? "selected" : ""}>Ù…Ø¯ÙŠØ±</option>
          </select><button class="btn btn-secondary small-btn" type="button" data-user-action="set-role" ${profile.uid === activeSession.uid || (profile.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL && profile.authType !== "shared-company-email") ? "disabled" : ""}>ØªØ­Ø¯ÙŠØ« Ø§Ù„Ø¯ÙˆØ±</button>
          ${profile.uid !== activeSession.uid && !(profile.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL && profile.authType !== "shared-company-email") ? '<button class="btn btn-danger small-btn" type="button" data-user-action="disable">ØªØ¹Ø·ÙŠÙ„ Ø§Ù„Ø­Ø³Ø§Ø¨</button>' : '<span class="module-state">Ø§Ù„Ù…Ø¯ÙŠØ± Ø§Ù„Ø£Ø³Ø§Ø³ÙŠ Ù…Ø­Ù…ÙŠ</span>'}</div></article>`).join("");
        byId("blocked-user-list").innerHTML = blocked.map(profile => `<article class="managed-user" data-managed-user="${escapeHTML(profile.uid)}">
          ${renderIdentity(profile)}<div class="managed-user-actions"><label class="sr-only" for="reactivate-role-${escapeHTML(profile.uid)}">Ø§Ù„Ø¯ÙˆØ± Ø¹Ù†Ø¯ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„ØªÙØ¹ÙŠÙ„</label>
          <select class="control" id="reactivate-role-${escapeHTML(profile.uid)}" data-user-role><option value="agent">Ù…ÙˆØ¸Ù</option><option value="admin">Ù…Ø¯ÙŠØ±</option></select>
          <button class="btn btn-secondary small-btn" type="button" data-user-action="reactivate">Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„ØªÙØ¹ÙŠÙ„</button></div></article>`).join("");
        byId("pending-user-empty").hidden = pending.length > 0;
        byId("active-user-empty").hidden = active.length > 0;
        byId("blocked-user-empty").hidden = blocked.length > 0;
      }
      async function updateManagedUser(uid, action, options = {}, actionName = "ØªÙ… ØªØ­Ø¯ÙŠØ« Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù….") {
        if (activeSession.role !== "admin" || activeSession.companyId !== SIGNUP_COMPANY_ID || !uid || uid === activeSession.uid) {
          showToast("Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…ÙŠÙ† Ù…ØªØ§Ø­Ø© Ù„Ù…Ø¯ÙŠØ± Ø´Ø±ÙƒØ© MJKØŒ ÙˆÙ„Ø§ ÙŠÙ…ÙƒÙ† ØªØºÙŠÙŠØ± Ø­Ø³Ø§Ø¨ Ø§Ù„Ù…Ø¯ÙŠØ± Ø§Ù„Ø­Ø§Ù„ÙŠ.");
          return;
        }
        const profile = managedUsers.find(user => user.uid === uid);
        if (!profile || profile.companyId !== activeSession.companyId) {
          showToast("Ù„Ù… ÙŠÙØ¹Ø«Ø± Ø¹Ù„Ù‰ Ù…Ø³ØªØ®Ø¯Ù… ØµØ§Ù„Ø­ Ø¶Ù…Ù† Ø´Ø±ÙƒØªÙƒ.");
          return;
        }
        const card = document.querySelector(`[data-managed-user="${CSS.escape(uid)}"]`);
        if (card) card.querySelectorAll("button,select").forEach(control => { control.disabled = true; });
        try {
          if (!cloudFunctions) throw new Error("Ø®Ø¯Ù…Ø© Firebase Functions ØºÙŠØ± Ù…Ù‡ÙŠØ£Ø©.");
          const result = await cloudFunctions.httpsCallable("manageEmployee")({ uid, action, ...options });
          if (action === "approve" && Number(result.data?.assigned) > 0) {
            actionName = `${actionName} ØªÙ… ØªØ¹ÙŠÙŠÙ† ${integer.format(result.data.assigned)} Ø¬Ù‡Ø© Ø§ØªØµØ§Ù„.`;
          }
          showToast(actionName);
        } catch (error) {
          console.error("Could not update company user approval or role:", error);
          showToast(`ØªØ¹Ø°Ø± ØªØ­Ø¯ÙŠØ« Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…: ${error.message || error.code}.`);
          if (card) card.querySelectorAll("button,select").forEach(control => { control.disabled = false; });
        }
      }
      function refreshSessionUi() {
        const admin = activeSession.ready && activeSession.role === "admin";
        byId("tab-admin").hidden = !admin;
        document.querySelector('[data-admin-panel="users"]').hidden = !admin || activeSession.companyId !== SIGNUP_COMPANY_ID;
        document.querySelectorAll(".tab-button[data-tab]").forEach(button => {
          button.hidden = !admin && activeSession.ready && activeSession.role === "agent"
            ? !EMPLOYEE_ALLOWED_TABS.has(button.dataset.tab)
            : button.dataset.tab === "admin" && !admin;
        });
        if (activeSession.role === "agent" && document.querySelector(".tab-button.active") &&
            !EMPLOYEE_ALLOWED_TABS.has(document.querySelector(".tab-button.active").dataset.tab)) switchTab("crm");
        if (!admin && document.querySelector('.tab-button[data-tab="admin"]').classList.contains("active")) switchTab("crm");
        byId("session-role-label").textContent = activeSession.ready
          ? `${activeSession.role === "admin" ? "Ù…Ø¯ÙŠØ± Ø§Ù„Ø´Ø±ÙƒØ©" : "Ù…ÙˆØ¸Ù"} Â· ${activeSession.companyId}`
          : cloudUser ? "ÙŠØªØ·Ù„Ø¨ Ù…Ù„Ù Ù…Ø³ØªØ®Ø¯Ù… ØµØ§Ù„Ø­" : "Ø¬Ù„Ø³Ø© Ù…Ø­Ù„ÙŠØ©";
        byId("admin-add-open").hidden = !admin;
        byId("lead-form").querySelectorAll("input,select,textarea,button").forEach(control => {
          control.disabled = Boolean(cloudUser && !activeSession.ready);
        });
        if (admin) renderAdminDashboard();
        if (admin && activeSession.companyId === SIGNUP_COMPANY_ID) renderManagedUsers();
        renderLeads();
        renderPipeline();
      }
      function switchLocalUser(uid, role, companyId, email = cloudUser?.email || "", authType = "") {
        const previousUid = cloudSyncMetadata.ownerUid;
        if (previousUid && previousUid !== uid) {
          try {
            localStorage.setItem(`mjkCloserLeads.user.${encodeURIComponent(previousUid)}`, localStorage.getItem(STORAGE_KEY) || "[]");
            localStorage.setItem(`mjkSalesTools.user.${encodeURIComponent(previousUid)}`, localStorage.getItem(APP_STATE_KEY) || JSON.stringify(appState));
            const savedLeads = localStorage.getItem(`mjkCloserLeads.user.${encodeURIComponent(uid)}`);
            leads = savedLeads ? JSON.parse(savedLeads) : [];
            const savedState = localStorage.getItem(`mjkSalesTools.user.${encodeURIComponent(uid)}`);
            appState = savedState ? { ...defaultAppState(), ...JSON.parse(savedState) } : defaultAppState();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
            localStorage.setItem(APP_STATE_KEY, JSON.stringify(appState));
            cloudSyncMetadata = { ownerUid: uid, versions: {}, tombstones: {} };
            if (!persistCloudSyncMetadata()) return false;
            lastLocalRecords = serializeCloudRecords(collectLocalCloudRecords());
          } catch (error) {
            console.error("Could not isolate local data for the signed-in Firebase user:", error);
            showToast("ØªØ¹Ø°Ø± ÙØµÙ„ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø³Ø§Ø¨Ø§Øª Ø¹Ù„Ù‰ Ù‡Ø°Ø§ Ø§Ù„Ø¬Ù‡Ø§Ø². Ù„Ù… ÙŠØªÙ… ØªÙØ¹ÙŠÙ„ Ø¬Ù„Ø³Ø© Ø§Ù„Ø´Ø±ÙƒØ©.");
            return false;
          }
        } else if (!previousUid) {
          if (role === "agent") {
            const savedLeads = localStorage.getItem(`mjkCloserLeads.user.${encodeURIComponent(uid)}`);
            const savedState = localStorage.getItem(`mjkSalesTools.user.${encodeURIComponent(uid)}`);
            try {
              leads = savedLeads ? JSON.parse(savedLeads) : [];
              appState = savedState ? { ...defaultAppState(), ...JSON.parse(savedState) } : defaultAppState();
              localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
              localStorage.setItem(APP_STATE_KEY, JSON.stringify(appState));
            } catch (error) {
              console.error("Could not initialize a clean employee workspace:", error);
              showToast("ØªØ¹Ø°Ø± ØªØ¬Ù‡ÙŠØ² Ù…Ø³Ø§Ø­Ø© Ø§Ù„Ù…ÙˆØ¸Ù Ø§Ù„Ù†Ø¸ÙŠÙØ©.");
              return false;
            }
          }
          cloudSyncMetadata.ownerUid = uid;
          if (!persistCloudSyncMetadata()) return false;
        }
        activeSession = { uid, email, role, companyId, authType, ready: true };
        if (role === "agent") {
          const allowedRecord = key => /^(appointments|customScripts)__/.test(key);
          cloudSyncMetadata.versions = Object.fromEntries(Object.entries(cloudSyncMetadata.versions).filter(([key]) => allowedRecord(key)));
          cloudSyncMetadata.tombstones = Object.fromEntries(Object.entries(cloudSyncMetadata.tombstones).filter(([key]) => allowedRecord(key)));
          if (!persistCloudSyncMetadata()) return false;
        }
        companyLeadCacheKey = companyLeadStorageKey(uid, companyId);
        try {
          const savedSettings = localStorage.getItem(companySettingsStorageKey(companyId));
          companySettings = normalizeCompanySettings(savedSettings ? JSON.parse(savedSettings) : defaultCompanySettings);
        } catch (error) {
          console.error("Could not load cached company module settings:", error);
          companySettings = normalizeCompanySettings();
        }
        try {
          const queue = JSON.parse(localStorage.getItem(`${companyLeadCacheKey}.pending`) || "{}");
          pendingCompanyLeadIds.clear();
          (Array.isArray(queue.leads) ? queue.leads : []).forEach(id => pendingCompanyLeadIds.add(id));
          pendingCompanyActionIds.clear();
          (Array.isArray(queue.actions) ? queue.actions : []).forEach(id => pendingCompanyActionIds.add(id));
        } catch (error) {
          console.error("Could not restore the company synchronization queue:", error);
        }
        const cached = localStorage.getItem(companyLeadCacheKey);
        if (cached) {
          try {
            leads = JSON.parse(cached).filter(canViewLead);
          } catch (error) {
            console.error("Could not load the company lead cache:", error);
            leads = [];
          }
        } else if (role === "admin" && (!previousUid || previousUid === uid)) {
          leads = leads.filter(lead => !lead.companyId || lead.companyId === companyId);
          pendingLegacyLeadMigration = leads.map(lead => ({
            ...lead, companyId, updatedAt: Date.now(),
            batchId: lead.batchId || lead.sourceBatchId || "",
            batchName: lead.batchName || (lead.sourceBatchId ? "Ø¯ÙØ¹Ø© CRM" : "")
          }));
          leads = pendingLegacyLeadMigration;
        } else {
          leads = [];
        }
        if (role === "agent") {
          appState = {
            ...defaultAppState(),
            appointments: Array.isArray(appState.appointments) ? appState.appointments : [],
            customScripts: Array.isArray(appState.customScripts) ? appState.customScripts : []
          };
          localStorage.setItem(APP_STATE_KEY, JSON.stringify(appState));
          localStorage.setItem(`mjkSalesTools.user.${encodeURIComponent(uid)}`, JSON.stringify(appState));
        }
        localStorage.setItem(companyLeadCacheKey, JSON.stringify(leads));
        try { companyActions = JSON.parse(localStorage.getItem(`${companyLeadCacheKey}.actions`) || "[]"); }
        catch (error) { console.error("Could not load the local lead action cache:", error); companyActions = []; }
        companyLeadRecords = new Map(leads.map(lead => [lead.id, JSON.stringify(lead)]));
        lastLocalRecords = serializeCloudRecords(collectLocalCloudRecords());
        refreshSessionUi();
        renderCompanyModules();
        return true;
      }
      function captureLocalCompanyLeadChanges() {
        if (cloudApplyingRemote || !activeSession.ready) return;
        const next = new Map(leads.filter(lead => canViewLead(lead)).map(lead => [lead.id, JSON.stringify(lead)]));
        next.forEach((serialized, id) => {
          if (companyLeadRecords.get(id) === serialized) return;
          const lead = leads.find(item => item.id === id);
          if (!lead || !canModifyLead(lead)) return;
          lead.companyId = activeSession.companyId;
          lead.updatedAt = Date.now();
          next.set(id, JSON.stringify(lead));
          pendingCompanyLeadIds.add(id);
        });
        companyLeadRecords.forEach((_, id) => {
          if (!next.has(id)) {
            showToast("Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø­Ø°Ù Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡Ø› Ø§Ø³ØªØ®Ø¯Ù… Ø­Ø§Ù„Ø© Ø§Ù„Ø±ÙØ¶ Ø£Ùˆ Ø§Ù„Ø£Ø±Ø´ÙØ© Ù„Ù„Ø­ÙØ§Ø¸ Ø¹Ù„Ù‰ Ø³Ø¬Ù„ Ø§Ù„Ø¹Ù…ÙŠÙ„.");
            const cached = localStorage.getItem(companyLeadCacheKey);
            if (cached) leads = JSON.parse(cached);
          }
        });
        companyLeadRecords = new Map(leads.filter(lead => canViewLead(lead)).map(lead => [lead.id, JSON.stringify(lead)]));
        persistCompanyPendingQueue();
        pendingCompanyLeadIds.forEach(id => {
          const lead = leads.find(item => item.id === id);
          if (lead && !companyLeadWriteQueues.has(id)) void writeCompanyLead(lead).catch(() => {});
        });
      }
      function writeCompanyLead(lead) {
        if (!activeSession.ready || !cloudDb || !navigator.onLine || !canModifyLead(lead)) return Promise.resolve();
        const leadId = lead.id;
        const companyId = activeSession.companyId;
        const companyCacheKey = companyLeadCacheKey;
        const payload = JSON.parse(JSON.stringify({ ...lead, companyId, updatedAt: Date.now() }));
        const reference = cloudDb.collection("companies").doc(companyId).collection("leads").doc(leadId);
        const previousWrite = companyLeadWriteQueues.get(leadId) || Promise.resolve();
        const write = previousWrite.catch(() => {}).then(async () => {
          writingCompanyLeadIds.add(leadId);
          try {
            try {
              await reference.update(payload);
            } catch (error) {
              if (error.code !== "not-found") throw error;
              await reference.set(payload);
            }
            const current = leads.find(item => item.id === leadId);
            if (current && leadPayloadMatches(current, payload)) {
              current.updatedAt = payload.updatedAt;
              pendingCompanyLeadIds.delete(leadId);
              companyLeadRecords.set(leadId, JSON.stringify(current));
            }
            persistCompanyPendingQueue();
            localStorage.setItem(companyCacheKey, JSON.stringify(leads));
          } catch (error) {
            console.error("Could not persist company lead to Firestore:", error);
            showToast(`ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø§Ù„Ø¹Ù…ÙŠÙ„ Ø³Ø­Ø§Ø¨ÙŠÙ‹Ø§Ø› Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ù…Ø­Ù„ÙŠØ© Ù…Ø­ÙÙˆØ¸Ø©: ${error.message || error.code}.`);
            setCloudStatus("ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø§Ù„Ø¹Ù…ÙŠÙ„ ÙÙŠ Firebase", "error");
            throw error;
          } finally {
            writingCompanyLeadIds.delete(leadId);
          }
        });
        companyLeadWriteQueues.set(leadId, write);
        write.finally(() => {
          if (companyLeadWriteQueues.get(leadId) === write) companyLeadWriteQueues.delete(leadId);
        }).catch(() => {});
        return write;
      }
      async function writeLeadAudit(lead, action, previousStatus, notes = "") {
        const entry = {
          id: makeId("action"), companyId: lead.companyId || activeSession.companyId || "",
          leadId: lead.id, agentId: activeSession.uid || "local",
          agentEmail: activeSession.email || "", agentName: activeSession.email || "Ù…Ø³ØªØ®Ø¯Ù… Ù…Ø­Ù„ÙŠ",
          action, notes, previousStatus: previousStatus || "new", status: lead.status || "new",
          createdAt: new Date().toISOString(), assignedTo: lead.assignedTo || ""
        };
        lead.lastAction = {
          action: entry.action, notes: entry.notes, agentName: entry.agentName,
          createdAt: entry.createdAt, previousStatus: entry.previousStatus, status: entry.status
        };
        persistLeads();
        companyActions = [entry, ...companyActions].slice(0, 500);
        pendingCompanyActionIds.add(entry.id);
        try {
          localStorage.setItem(companyLeadCacheKey ? `${companyLeadCacheKey}.actions` : "mjkLeadActions.local", JSON.stringify(companyActions));
          persistCompanyPendingQueue();
        } catch (error) {
          console.error("Could not save the local lead audit queue:", error);
          showToast("ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø³Ø¬Ù„ Ø§Ù„Ù†Ø´Ø§Ø· Ù…Ø­Ù„ÙŠÙ‹Ø§Ø› ØµØ¯Ù‘Ø± Ù†Ø³Ø®Ø© Ø§Ø­ØªÙŠØ§Ø·ÙŠØ© ÙÙˆØ±Ù‹Ø§.");
        }
        renderPipeline();
        await flushPendingLeadActions(lead.id);
      }
      async function flushPendingLeadActions(onlyLeadId = "") {
        if (!activeSession.ready || !navigator.onLine) return;
        for (const id of [...pendingCompanyActionIds]) {
          const entry = companyActions.find(item => item.id === id);
          if (!entry || (onlyLeadId && entry.leadId !== onlyLeadId)) continue;
          const lead = leads.find(item => item.id === entry.leadId && canViewLead(item));
          if (!lead) continue;
          try {
            await companyLeadsPath().doc(entry.leadId).collection("actions").doc(entry.id).set(entry);
            pendingCompanyActionIds.delete(entry.id);
            persistCompanyPendingQueue();
          } catch (error) {
            console.error("Could not write lead audit event to Firestore:", error);
            showToast(`Ø­ÙÙØ¸ Ø§Ù„Ù†Ø´Ø§Ø· Ù…Ø­Ù„ÙŠÙ‹Ø§ Ù„ÙƒÙ† ØªØ¹Ø°Ø± Ø±ÙØ¹Ù‡ Ø¥Ù„Ù‰ Firestore: ${error.message || error.code}.`);
            return;
          }
        }
      }
      function attachCompanyLeadsListener() {
        if (!activeSession.ready || !cloudDb) return;
        if (companyLeadsListener) companyLeadsListener();
        companyInitialServerSnapshot = false;
        let query = companyLeadsPath().where("companyId", "==", activeSession.companyId);
        if (activeSession.role === "agent") {
          const assignees = activeSession.authType === "shared-company-email"
            ? [activeSession.uid]
            : [...new Set([activeSession.uid, activeSession.email].filter(Boolean))];
          query = query.where("assignedTo", "in", assignees);
        }
        query = query.limit(100);
        companyLeadsListener = query.onSnapshot({ includeMetadataChanges: true }, snapshot => {
          if (snapshot.metadata?.fromCache && navigator.onLine && !companyInitialServerSnapshot) return;
          if (!snapshot.metadata?.fromCache) companyInitialServerSnapshot = true;
          const remoteLeads = new Map(snapshot.docs.map(document => [document.id, document.data()]));
          if (snapshot.metadata?.fromCache && navigator.onLine && !companyInitialServerSnapshot) return;
          const merged = new Map(remoteLeads);
          leads.forEach(lead => {
            if (pendingCompanyLeadIds.has(lead.id) || writingCompanyLeadIds.has(lead.id)) {
              const remote = remoteLeads.get(lead.id);
              if (remote && leadPayloadMatches(lead, remote)) pendingCompanyLeadIds.delete(lead.id);
              else merged.set(lead.id, lead);
            }
          });
          leads = [...merged.values()].filter(canViewLead);
          companyLeadRecords = new Map(leads.map(lead => [lead.id, JSON.stringify(lead)]));
          persistCompanyPendingQueue();
          try { localStorage.setItem(companyLeadCacheKey, JSON.stringify(leads)); }
          catch (error) { console.error("Could not cache company leads locally:", error); showToast("ØªØ¹Ø°Ø± ØªØ­Ø¯ÙŠØ« Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ù…Ø­Ù„ÙŠØ© Ù„Ù„Ø¹Ù…Ù„Ø§Ø¡."); }
          renderLeads();
          renderAnalytics();
          renderPipeline();
          renderAdminDashboard();
          if (!snapshot.metadata?.fromCache) setCloudStatus("ðŸŸ¢ Ù…ØªØµÙ„ Ø£ÙˆÙ†Ù„Ø§ÙŠÙ† Â· Ù…Ø²Ø§Ù…Ù†Ø© Ù…Ø¨Ø§Ø´Ø±Ø©", "synced");
          if (companyInitialServerSnapshot) {
            void migratePendingCompanyLeads(remoteLeads);
            pendingCompanyLeadIds.forEach(id => {
              const lead = leads.find(item => item.id === id);
              if (lead && !companyLeadWriteQueues.has(id)) void writeCompanyLead(lead).catch(() => {});
            });
          }
          if (companyInitialServerSnapshot) void flushPendingLeadActions();
        }, error => {
          console.error("Company lead listener failed:", error);
          setCloudStatus("ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ø¹Ù…Ù„Ø§Ø¡ Ø§Ù„Ø´Ø±ÙƒØ©", "error");
          showToast(`ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø´Ø±ÙƒØ©: ${error.message || error.code}.`);
        });
      }
      async function migratePendingCompanyLeads(remoteLeads) {
        if (activeSession.role !== "admin" || (!pendingLegacyLeadMigration.length && !legacyCloudLeadRecords.size)) return;
        const migration = [
          ...legacyCloudLeadRecords.values(),
          ...pendingLegacyLeadMigration.splice(0)
        ];
        legacyCloudLeadRecords.clear();
        const unique = new Map(migration.map(lead => [lead.id, lead]));
        const toAdd = [...unique.values()].filter(lead => !remoteLeads.has(lead.id));
        if (!toAdd.length) return;
        leads = [...toAdd, ...leads.filter(lead => !toAdd.some(item => item.id === lead.id))];
        toAdd.forEach(lead => pendingCompanyLeadIds.add(lead.id));
        persistCompanyPendingQueue();
        try {
          localStorage.setItem(companyLeadCacheKey, JSON.stringify(leads));
          companyLeadRecords = new Map(leads.map(lead => [lead.id, JSON.stringify(lead)]));
          await Promise.all(toAdd.map(writeCompanyLead));
          showToast(`ØªÙ… Ø±Ø¨Ø· ${toAdd.length} Ø¹Ù…ÙŠÙ„Ù‹Ø§ Ù‚Ø¯ÙŠÙ…Ù‹Ø§ Ø¨Ø´Ø±ÙƒØ© ${activeSession.companyId}.`);
          renderLeads();
        } catch (error) {
          pendingLegacyLeadMigration = [...migration, ...pendingLegacyLeadMigration];
          console.error("Could not migrate legacy company leads:", error);
          showToast(`ØªØ¹Ø°Ø± ØªØ±Ø­ÙŠÙ„ Ø¨Ø¹Ø¶ Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡ Ø§Ù„Ù‚Ø¯Ø§Ù…Ù‰: ${error.message || error.code}.`);
        }
      }
      function attachTeamProfilesListener() {
        if (!cloudDb) return;
        if (teamProfilesListener) teamProfilesListener();
        teamProfiles = [];
        if (!activeSession.ready || activeSession.role !== "admin") { refreshSessionUi(); return; }
        teamProfilesListener = cloudDb.collection("users")
          .where("companyId", "==", activeSession.companyId)
          .limit(100)
          .onSnapshot(snapshot => {
            teamProfiles = snapshot.docs.map(document => ({ uid: document.id, ...document.data() }))
              .filter(profile => profile.role === "agent" && ["active", "approved", undefined].includes(profile.status));
            renderAdminDashboard();
            renderLeads();
          }, error => {
            console.error("Could not load company agent profiles:", error);
            showToast(`ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ ÙØ±ÙŠÙ‚ Ø§Ù„Ø´Ø±ÙƒØ©: ${error.message || error.code}.`);
          });
      }
      function attachUserManagementListener() {
        if (!cloudDb) return;
        if (userManagementListener) userManagementListener();
        userManagementListener = null;
        managedUsers = [];
        initialManagedUsersSnapshot = true;
        if (!activeSession.ready || !cloudDb || activeSession.role !== "admin" || activeSession.companyId !== SIGNUP_COMPANY_ID) {
          byId("user-management-status").textContent = "ÙŠØªØ·Ù„Ø¨ Ù…Ø¯ÙŠØ± Ø´Ø±ÙƒØ© MJK";
          renderManagedUsers();
          return;
        }
        byId("user-management-status").textContent = "Ø¬Ø§Ø±Ù ØªØ­Ù…ÙŠÙ„ Ø£Ø¹Ø¶Ø§Ø¡ Ø§Ù„Ø´Ø±ÙƒØ©";
        userManagementListener = cloudDb.collection("users")
          .where("companyId", "==", SIGNUP_COMPANY_ID)
          .limit(100)
          .onSnapshot(snapshot => {
            const previousPending = new Set(managedUsers
              .filter(profile => profile.status === "pending" || profile.role === "pending")
              .map(profile => profile.uid));
            managedUsers = snapshot.docs.map(document => ({ uid: document.id, ...document.data() }));
            const pending = managedUsers.filter(profile => profile.status === "pending" || profile.role === "pending");
            if (!initialManagedUsersSnapshot) {
              pending.filter(profile => !previousPending.has(profile.uid)).forEach(profile => {
                if (alertedRegistrationIds.has(profile.uid)) return;
                alertedRegistrationIds.add(profile.uid);
                startAlert(`employee-${profile.uid}`, "ØªØ³Ø¬ÙŠÙ„ Ù…ÙˆØ¸Ù Ø¬Ø¯ÙŠØ¯", `${profile.fullName || profile.email || "Ù…ÙˆØ¸Ù"} Ø£Ø±Ø³Ù„ Ø·Ù„Ø¨ Ø§Ù†Ø¶Ù…Ø§Ù….`, navigateToEmployeeRequests);
              });
            }
            initialManagedUsersSnapshot = false;
            byId("user-management-status").textContent = `ØªØ­Ø¯ÙŠØ« Ù…Ø¨Ø§Ø´Ø± Â· ${managedUsers.length} Ù…Ø³ØªØ®Ø¯Ù…`;
            renderManagedUsers();
            renderAdminNotifications();
          }, error => {
            console.error("Company user management listener failed:", error);
            byId("user-management-status").textContent = "ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ø£Ø¹Ø¶Ø§Ø¡ Ø§Ù„Ø´Ø±ÙƒØ©";
            showToast(`ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ø·Ù„Ø¨Ø§Øª Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…ÙŠÙ†: ${error.message || error.code}.`);
          });
      }
      async function handleUserProfileSnapshot(user, snapshot, generation) {
        if (generation !== authSessionGeneration || cloudUser?.uid !== user.uid) return;
       const isPrimaryAdmin = Boolean(user.email && user.email.trim() !== "");
        if (snapshot.metadata?.fromCache) {
          if (isPrimaryAdmin) {
            hideApprovalScreen();
            refreshSessionUi();
            byId("cloud-account-status").textContent = "Ø¬Ø§Ø±Ù Ø§Ø³ØªØ¹Ø§Ø¯Ø© ØµÙ„Ø§Ø­ÙŠØ§Øª Ø§Ù„Ù…Ø¯ÙŠØ± Ø§Ù„Ø£Ø³Ø§Ø³ÙŠØ© Ù…Ù† Firestoreâ€¦";
            return;
          }
          showApprovalScreen({ role: "pending", status: "pending" },
            "Ø¬Ø§Ø±Ù Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† Ø­Ø§Ù„Ø© Ø§Ù„Ø­Ø³Ø§Ø¨ Ù…Ø¹ Ø®Ø§Ø¯Ù… Ø§Ù„Ø´Ø±ÙƒØ©. Ù„Ø§ ÙŠÙ…ÙƒÙ† ÙØªØ­ Ù…Ø³Ø§Ø­Ø© Ø§Ù„Ø¹Ù…Ù„ Ù‚Ø¨Ù„ ØªØ£ÙƒÙŠØ¯ Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ©.");
          return;
        }
        if (!snapshot.exists) {
         if (isPrimaryAdmin) {
         hideApprovalScreen();
         refreshSessionUi();
         return;
         }
         blockCompanySession({ role: "pending", status: "pending" }, "Ù„Ù… ÙŠÙƒØªÙ…Ù„ Ù…Ù„Ù Ø­Ø³Ø§Ø¨Ùƒ Ø¨Ø¹Ø¯. Ø¥Ø°Ø§ ÙƒÙ†Øª Ù‚Ø¯ Ø£Ù†Ø´Ø£Øª Ø§Ù„Ø­Ø³Ø§Ø¨ Ù„Ù„ØªÙˆØŒ Ø§Ù†ØªØ¸Ø± Ù„Ø­Ø¸Ø§Øª Ø«Ù… ØªØ­Ù‚Ù‚ Ù…Ø¬Ø¯Ø¯Ø§Ù‹");
         return;
         }
        const profile = snapshot.data();
        const status = profile.status || (["admin", "agent"].includes(profile.role) ? "active" : "pending");
        profile.status = status;
        /*
        if (isPrimaryAdmin && (profile.role !== "admin" || !["approved", "active"].includes(status))) {
          try {
         await cloudFunctions.httpsCallable("bootstrapPrimaryAdmin")({});
         return;
         } catch (error) {
         console.error("Could not update primary administrator profile:", error);
         }
        
         */
        if (status === "pending" || profile.role === "pending") {
          blockCompanySession(profile);
          return;
        }
        if (!["active", "approved"].includes(status) || !["admin", "agent"].includes(profile.role)) {
          blockCompanySession(profile, status === "rejected"
            ? "ØªÙ… Ø±ÙØ¶ Ø·Ù„Ø¨ Ø§Ù„Ø­Ø³Ø§Ø¨. ØªÙˆØ§ØµÙ„ Ù…Ø¹ Ù…Ø¯ÙŠØ± Ø§Ù„Ø´Ø±ÙƒØ© Ø¥Ø°Ø§ ÙƒÙ†Øª ØªØ¹ØªÙ‚Ø¯ Ø£Ù† Ø°Ù„Ùƒ Ø­Ø¯Ø« Ø¨Ø§Ù„Ø®Ø·Ø£."
            : "Ù‡Ø°Ø§ Ø§Ù„Ø­Ø³Ø§Ø¨ Ù…Ø¹Ø·Ù‘Ù„ Ø­Ø§Ù„ÙŠÙ‹Ø§. ØªÙˆØ§ØµÙ„ Ù…Ø¹ Ù…Ø¯ÙŠØ± Ø§Ù„Ø´Ø±ÙƒØ© Ù„Ø¥Ø¹Ø§Ø¯Ø© ØªÙØ¹ÙŠÙ„Ù‡.");
          return;
        }
        if (typeof profile.companyId !== "string" || !profile.companyId.trim()) {
          blockCompanySession(profile, "Ù…Ù„Ù Ø§Ù„Ø´Ø±ÙƒØ© ØºÙŠØ± Ù…ÙƒØªÙ…Ù„. ØªÙˆØ§ØµÙ„ Ù…Ø¹ Ù…Ø¯ÙŠØ± Ø§Ù„Ù†Ø¸Ø§Ù….");
          return;
        }
        if (!activeSession.ready || activeSession.uid !== user.uid ||
            activeSession.role !== profile.role || activeSession.companyId !== profile.companyId ||
            activeSession.authType !== (profile.authType || "") || activeSession.email !== (profile.email || user.email || "")) {
          if (!switchLocalUser(user.uid, profile.role, profile.companyId, profile.email || user.email || "", profile.authType || "")) {
            blockCompanySession(profile, "ØªØ¹Ø°Ø± Ø¥Ø¹Ø¯Ø§Ø¯ Ù…Ø³Ø§Ø­Ø© Ø¹Ù…Ù„ Ù‡Ø°Ø§ Ø§Ù„Ø­Ø³Ø§Ø¨ Ø¹Ù„Ù‰ Ø§Ù„Ø¬Ù‡Ø§Ø².");
            return;
          }
        }
        hideApprovalScreen();
        attachCompanyLeadsListener();
        attachTeamProfilesListener();
        attachUserManagementListener();
        attachCompanySettingsListener();
        attachCloudListener();
        refreshSessionUi();
      }
       function attachUserProfileListener(user) {
        if (!user || !cloudDb) return;
        if (userProfileListener) userProfileListener();
        const generation = ++authSessionGeneration;
        userProfileListener = cloudDb.collection("users").doc(user.uid).onSnapshot(
          snapshot => handleUserProfileSnapshot(user, snapshot, generation),
          error => {
            console.error("Firebase user profile listener failed:", error);
            blockCompanySession({ role: "pending", status: "pending" },
              `ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ø­Ø§Ù„Ø© Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø©: ${error.message || error.code}. ØªØ­Ù‚Ù‚ Ù…Ù† Ø§Ù„Ø§ØªØµØ§Ù„ Ø«Ù… Ø£Ø¹Ø¯ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø©.`);
          }
        );
      }
      function attachCompanySettingsListener() {
          if (companySettingsListener) companySettingsListener();
          companySettingsListener = null;
          if (!activeSession.ready || !cloudDb) return;
          companySettingsListener = companySettingsPath().onSnapshot(snapshot => {
            if (localStorage.getItem(companySettingsPendingKey()) === "true") {
              try {
                const cached = localStorage.getItem(companySettingsStorageKey());
                if (cached) companySettings = normalizeCompanySettings(JSON.parse(cached));
              } catch (error) { console.error("Could not restore pending company settings:", error); }
              if (navigator.onLine) void flushPendingCompanySettings();
              renderCompanyModules();
              return;
            }
            companySettings = normalizeCompanySettings(snapshot.exists ? snapshot.data() : defaultCompanySettings);
            try { localStorage.setItem(companySettingsStorageKey(), JSON.stringify(companySettings)); }
            catch (error) { console.error("Could not cache company module settings:", error); }
            renderCompanyModules();
          }, error => {
            console.error("Company feature settings listener failed:", error);
            byId("module-settings-status").textContent = "ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ø´Ø±ÙƒØ©";
            showToast(`ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ ÙˆØ­Ø¯Ø§Øª Ø§Ù„Ø´Ø±ÙƒØ©: ${error.message || error.code}.`);
          });
      }
      function loadCloudSyncMetadata() {
        try {
          const parsed = JSON.parse(localStorage.getItem(CLOUD_SYNC_META_KEY) || "{}");
          return {
            ownerUid: typeof parsed.ownerUid === "string" ? parsed.ownerUid : "",
            versions: parsed && typeof parsed.versions === "object" && parsed.versions ? parsed.versions : {},
            tombstones: parsed && typeof parsed.tombstones === "object" && parsed.tombstones ? parsed.tombstones : {}
          };
        } catch (error) {
          console.error("Could not load cloud sync metadata:", error);
          return { ownerUid: "", versions: {}, tombstones: {} };
        }
      }
      function persistCloudSyncMetadata() {
        try {
          localStorage.setItem(CLOUD_SYNC_META_KEY, JSON.stringify(cloudSyncMetadata));
          return true;
        } catch (error) {
          console.error("Could not save cloud sync metadata:", error);
          showToast("ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø·Ø§Ø¨ÙˆØ± Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø© Ù…Ø­Ù„ÙŠÙ‹Ø§. Ù†Ø²Ù‘Ù„ Ù†Ø³Ø®Ø© Ø§Ø­ØªÙŠØ§Ø·ÙŠØ© Ù‚Ø¨Ù„ Ø§Ù„Ù…ØªØ§Ø¨Ø¹Ø©.");
          setCloudStatus("ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø·Ø§Ø¨ÙˆØ± Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø©", "error");
          return false;
        }
      }
      function cloudRecordKey(kind, id) {
        return `${kind}__${encodeURIComponent(String(id))}`;
      }
      function collectLocalCloudRecords() {
        const records = new Map();
        cloudCollections.forEach(kind => {
          if (activeSession.role === "agent" && !["appointments", "customScripts"].includes(kind)) return;
          const items = appState[kind];
          if (!Array.isArray(items)) return;
          items.forEach(item => {
            if (item && typeof item.id === "string") records.set(cloudRecordKey(kind, item.id), { kind, id: item.id, data: item });
          });
        });
        if (activeSession.role !== "agent") {
          const meta = {
            cleanerBatchRuns: appState.cleanerBatchRuns,
            cleanerRows: appState.cleanerRows,
            rawContacts: appState.rawContacts || "",
            cleanerPreferences: appState.cleanerPreferences || null,
            lastCleanerStats: appState.lastCleanerStats || { duplicates: 0, invalid: 0, batches: 0 }
          };
          records.set(cloudRecordKey("meta", "app"), { kind: "meta", id: "app", data: meta });
        }
        return records;
      }
      function serializeCloudRecords(records) {
        return new Map([...records].map(([key, record]) => [key, JSON.stringify(record)]));
      }
      function captureLocalCloudChanges() {
        if (cloudApplyingRemote) return;
        const current = collectLocalCloudRecords();
        const keys = new Set([...lastLocalRecords.keys(), ...current.keys()]);
        const changedKeys = new Set();
        keys.forEach(key => {
          const before = lastLocalRecords.get(key);
          const after = current.get(key);
          const serializedAfter = JSON.stringify(after);
          if (before === serializedAfter) return;
          const previousVersion = Number(cloudSyncMetadata.versions[key]) || 0;
          const timestamp = Math.max(Date.now(), previousVersion + 1);
          cloudSyncMetadata.versions[key] = timestamp;
          if (after) delete cloudSyncMetadata.tombstones[key];
          else cloudSyncMetadata.tombstones[key] = timestamp;
          changedKeys.add(key);
        });
        lastLocalRecords = serializeCloudRecords(current);
        if (changedKeys.size) {
          if (persistCloudSyncMetadata()) scheduleCloudSync(changedKeys);
        }
      }
      lastLocalRecords = serializeCloudRecords(collectLocalCloudRecords());

      function persistAppState(showError = true) {
        try {
          localStorage.setItem(APP_STATE_KEY, JSON.stringify(appState));
          captureLocalCloudChanges();
          return true;
        } catch (error) {
          console.error("Could not save MJK sales tools state:", error);
          if (showError) showToast("ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§ØªØ› Ù‚Ø¯ ØªÙƒÙˆÙ† Ù…Ø³Ø§Ø­Ø© Ø§Ù„Ù…ØªØµÙØ­ Ù…Ù…ØªÙ„Ø¦Ø©. Ù†Ø²Ù‘Ù„ Ù…Ù„ÙØ§Øª Ø§Ù„Ø£Ø±Ø´ÙŠÙ Ø£Ùˆ Ø§Ø­Ø°Ù Ù…Ø±ÙÙ‚Ø§Øª Ù‚Ø¯ÙŠÙ…Ø©.");
          return false;
        }
      }

      function makeId(prefix = "mjk") {
        return `${prefix}-${window.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
      }

      byId("reset-app").addEventListener("click", async () => {
        const confirmed = window.confirm(
          "Ø³ÙŠØªÙ… Ø­Ø°Ù Ø¨ÙŠØ§Ù†Ø§Øª MJK Ø§Ù„Ù…Ø­Ù„ÙŠØ© ÙˆØ·Ø§Ø¨ÙˆØ± Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø© Ù…Ù† Ù‡Ø°Ø§ Ø§Ù„Ø¬Ù‡Ø§Ø² ÙˆØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø®Ø±ÙˆØ¬. Ù„Ù† ØªÙØ­Ø°Ù Ù†Ø³Ø®Ø© Firebase Ø§Ù„Ø³Ø­Ø§Ø¨ÙŠØ©ØŒ ÙˆÙŠÙ…ÙƒÙ† Ø§Ø³ØªØ¹Ø§Ø¯ØªÙ‡Ø§ Ø¹Ù†Ø¯ ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù…Ø¬Ø¯Ø¯Ù‹Ø§. Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ù„ØªØ±Ø§Ø¬Ø¹ Ø¹Ù† Ø­Ø°Ù Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø­Ù„ÙŠØ©. Ù‡Ù„ ØªØ±ÙŠØ¯ Ø§Ù„Ù…ØªØ§Ø¨Ø¹Ø©ØŸ"
        );
        if (!confirmed) return;
        try {
          stopAlert();
          if (cloudAuth?.currentUser) await cloudAuth.signOut();
          const appKeyPrefixes = ["mjkCloserLeads.", "mjkSalesTools.", "mjkCalculator.", "mjk-sales-tools.", "mjkCloud.syncMetadata."];
          const keysToRemove = Object.keys(localStorage).filter(key => appKeyPrefixes.some(prefix => key.startsWith(prefix)));
          keysToRemove.forEach(key => localStorage.removeItem(key));
          for (let index = sessionStorage.length - 1; index >= 0; index--) {
            const key = sessionStorage.key(index);
            if (key && key.startsWith("mjk-reminder-")) sessionStorage.removeItem(key);
          }
          window.location.reload();
        } catch (error) {
          console.error("Could not reset MJK local data:", error);
          showToast("ØªØ¹Ø°Ø± ØªØµÙÙŠØ± Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„ØªØ·Ø¨ÙŠÙ‚. ØªØ­Ù‚Ù‚ Ù…Ù† Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„ØªØ®Ø²ÙŠÙ† ÙÙŠ Ø§Ù„Ù…ØªØµÙØ­.");
        }
      });

      function loadLeads() {
        try {
          const saved = localStorage.getItem(STORAGE_KEY);
          const parsed = saved ? JSON.parse(saved) : [];
          return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === "string") : [];
        } catch (error) {
          console.error("Could not load MJK client data from localStorage:", error);
          return [];
        }
      }

      function persistLeads() {
        try {
          if (activeSession.ready) {
            leads.forEach(lead => {
              lead.companyId = activeSession.companyId;
              if (activeSession.role === "agent" && !lead.assignedTo) lead.assignedTo = activeSession.uid;
            });
          }
          captureLocalCompanyLeadChanges();
          localStorage.setItem(companyLeadCacheKey && activeSession.ready ? companyLeadCacheKey : STORAGE_KEY, JSON.stringify(leads));
          return true;
        } catch (error) {
          console.error("Could not save MJK client data to localStorage:", error);
          showToast("ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª. ØªØ­Ù‚Ù‚ Ù…Ù† Ù…Ø³Ø§Ø­Ø© Ø§Ù„ØªØ®Ø²ÙŠÙ† ÙˆØ¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ù…ØªØµÙØ­.");
          return false;
        }
      }

      function showToast(message) {
        byId("toast-text").textContent = message;
        byId("toast").classList.add("show");
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => byId("toast").classList.remove("show"), 3000);
      }

      function playAlertChime() {
        try {
          const AudioContextType = window.AudioContext || window.webkitAudioContext;
          if (!AudioContextType) return;
          if (!alertAudioContext) alertAudioContext = new AudioContextType();
          if (alertAudioContext.state === "suspended") void alertAudioContext.resume();
          const start = alertAudioContext.currentTime;
          [660, 880, 660].forEach((frequency, index) => {
            const oscillator = alertAudioContext.createOscillator();
            const gain = alertAudioContext.createGain();
            const at = start + index * 0.16;
            oscillator.type = "sine";
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, at);
            gain.gain.exponentialRampToValueAtTime(0.32, at + 0.025);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
            oscillator.connect(gain);
            gain.connect(alertAudioContext.destination);
            oscillator.start(at);
            oscillator.stop(at + 0.15);
          });
        } catch (error) {
          console.error("Could not play the MJK alert sound:", error);
        }
      }
      document.addEventListener("pointerdown", () => {
        const AudioContextType = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextType) return;
        try {
          if (!alertAudioContext) alertAudioContext = new AudioContextType();
          if (alertAudioContext.state === "suspended") {
            void alertAudioContext.resume().catch(error => console.error("Could not enable the MJK alert audio:", error));
          }
        } catch (error) {
          console.error("Could not initialize the MJK alert audio:", error);
        }
      }, { once: true });
      function stopAlert() {
        if (alertInterval) window.clearInterval(alertInterval);
        alertInterval = 0;
        activeAlertKey = "";
        byId("stop-alert").hidden = true;
      }
      function startAlert(key, title, body, onClick = null) {
        if (activeAlertKey !== key) {
          stopAlert();
          activeAlertKey = key;
          playAlertChime();
          alertInterval = window.setInterval(playAlertChime, 1500);
          byId("stop-alert").hidden = false;
        }
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            const notification = new Notification(title, { body, tag: key, renotify: true });
            if (onClick) notification.onclick = () => {
              window.focus();
              stopAlert();
              onClick();
              notification.close();
            };
          } catch (error) {
            console.error("Could not display the MJK browser notification:", error);
          }
        }
        showToast(body);
      }
      async function enableNotificationsAfterLogin() {
        let permission = "unsupported";
        if ("Notification" in window) {
          try {
            permission = Notification.permission === "default"
              ? await Notification.requestPermission()
              : Notification.permission;
          } catch (error) {
            console.error("Could not request notification permission after sign-in:", error);
            permission = "denied";
          }
        }
        try {
          const AudioContextType = window.AudioContext || window.webkitAudioContext;
          if (AudioContextType && !alertAudioContext) alertAudioContext = new AudioContextType();
          if (alertAudioContext?.state === "suspended") await alertAudioContext.resume();
          if (!alertAudioContext || alertAudioContext.state === "running") playAlertChime();
          else showToast("Ø³ÙØ¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„. Ø§Ø¶ØºØ· Â«ØªÙØ¹ÙŠÙ„ Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ø§Ù„Ù…Ø¯ÙŠØ±Â» Ù„ØªØ´ØºÙŠÙ„ Ø§Ù„ØµÙˆØª Ø¨Ø¹Ø¯ Ø³Ù…Ø§Ø­ Ø§Ù„Ù…ØªØµÙØ­.");
        } catch (error) {
          console.error("Could not activate alert audio after sign-in:", error);
          showToast("Ø³ÙØ¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„. Ø§Ø¶ØºØ· Â«ØªÙØ¹ÙŠÙ„ Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ø§Ù„Ù…Ø¯ÙŠØ±Â» Ù„ØªÙØ¹ÙŠÙ„ Ø§Ù„ØµÙˆØª ÙŠØ¯ÙˆÙŠÙ‹Ø§.");
        }
        if (permission === "denied") {
          showToast("Ø³ÙØ¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ØŒ Ù„ÙƒÙ† Ø§Ù„Ù…ØªØµÙØ­ Ø­Ø¸Ø± Ø§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª. Ø§Ø³Ù…Ø­ Ø¨Ù‡Ø§ Ù…Ù† Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ù…ÙˆÙ‚Ø¹.");
        }
      }
      function setAdminPanel(name) {
        document.querySelectorAll("[data-admin-panel]").forEach(button => {
          const selected = button.dataset.adminPanel === name;
          button.classList.toggle("active", selected);
          button.setAttribute("aria-selected", String(selected));
        });
        document.querySelectorAll(".admin-subpanel").forEach(panel => {
          panel.hidden = panel.id !== `admin-panel-${name}`;
        });
        if (name === "modules") renderCompanyModules();
        if (name === "users") attachUserManagementListener();
        if (name === "messages") renderAdminNotifications();
      }
      function navigateToEmployeeRequests() {
        if (activeSession.role !== "admin" || !activeSession.ready) return;
        stopAlert();
        switchTab("admin");
        setAdminPanel("messages");
        window.setTimeout(() => {
          setAdminPanel("users");
          window.setTimeout(() => {
            byId("pending-user-list").scrollIntoView({ behavior: "smooth", block: "start" });
            byId("pending-user-list").querySelector("[data-managed-user]")?.focus?.();
          }, 100);
        }, 700);
      }
      function renderAdminNotifications() {
        const pending = managedUsers.filter(profile => profile.status === "pending" || profile.role === "pending");
        byId("admin-notification-list").innerHTML = pending.map(profile => `<article class="managed-user">
          <div class="managed-user-head"><div><strong>${escapeHTML(profile.fullName || "Ø·Ù„Ø¨ Ù…ÙˆØ¸Ù Ø¬Ø¯ÙŠØ¯")}</strong>
          <div class="managed-user-meta">${escapeHTML(profile.email || "")}</div></div><span class="role-badge">Ø·Ù„Ø¨ Ø§Ù†Ø¶Ù…Ø§Ù…</span></div>
          <button class="btn btn-primary small-btn" type="button" data-open-employee-request="${escapeHTML(profile.uid)}">Ø¹Ø±Ø¶ Ø§Ù„Ø·Ù„Ø¨</button>
        </article>`).join("");
        byId("admin-notification-empty").hidden = pending.length > 0;
      }

      function setCloudStatus(message, mode = "local") {
        const button = byId("cloud-sync-open");
        const text = byId("cloud-status-text");
        const icon = byId("cloud-status-icon");
        if (!button || !text || !icon) return;
        text.textContent = message;
        button.classList.remove("is-synced", "is-pending", "is-error");
        if (mode === "synced") { button.classList.add("is-synced"); icon.textContent = "ðŸŸ¢"; }
        else if (mode === "pending") { button.classList.add("is-pending"); icon.textContent = "ðŸŸ "; }
        else if (mode === "error") { button.classList.add("is-error"); icon.textContent = "ðŸ”´"; }
        else { icon.textContent = "â˜ï¸"; }
        const liveStatus = byId("header-live-status");
        const liveText = byId("header-live-text");
        if (liveStatus && liveText) {
          liveStatus.classList.toggle("is-offline", !navigator.onLine || mode === "error" || !cloudUser);
          liveText.textContent = !navigator.onLine ? "Ø£ÙˆÙÙ„Ø§ÙŠÙ† Â· Ù…Ø­ÙÙˆØ¸ Ù…Ø­Ù„ÙŠÙ‹Ø§"
            : cloudUser && activeSession.ready && companyInitialServerSnapshot ? "Ù…ØªØµÙ„ Ø£ÙˆÙ†Ù„Ø§ÙŠÙ† Â· Ù…Ø²Ø§Ù…Ù†Ø© Ù…Ø¨Ø§Ø´Ø±Ø©"
              : cloudUser && activeSession.ready ? "Ø¬Ø§Ø±Ù Ø§Ù„Ø§ØªØµØ§Ù„ Ø¨Ø§Ù„Ø´Ø±ÙƒØ©"
                : cloudUser ? "ØªØ­Ù‚Ù‚ Ù…Ù† ØµÙ„Ø§Ø­ÙŠØ§Øª Ø§Ù„Ø­Ø³Ø§Ø¨" : "Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ù…Ø­ÙÙˆØ¸Ø© Ø¹Ù„Ù‰ Ù‡Ø°Ø§ Ø§Ù„Ø¬Ù‡Ø§Ø²";
        }
      }
      function cloudRecordsPath() {
        if (!cloudUser) throw new Error("Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ø¥Ù„Ù‰ Firebase Ø£ÙˆÙ„Ù‹Ø§.");
        return cloudDb.collection("users").doc(cloudUser.uid).collection("records");
      }
      function cloudChunkId(key, index) {
        return `chunk__${encodeURIComponent(key)}__${String(index).padStart(4, "0")}`;
      }
      function splitCloudPayload(payload) {
        const chunks = [];
        let start = 0;
        const chunkLength = 180000;
        while (start < payload.length) {
          let end = Math.min(payload.length, start + chunkLength);
          if (end < payload.length && /[\uD800-\uDBFF]/.test(payload[end - 1])) end--;
          chunks.push(payload.slice(start, end));
          start = end;
        }
        return chunks;
      }
      function decodeCloudSnapshot(snapshot) {
        const roots = new Map();
        const chunks = new Map();
        snapshot.docs.forEach(document => {
          const value = document.data();
          if (value.kind !== "chunk") {
            if (typeof value.key === "string") roots.set(value.key, value);
            return;
          }
          if (typeof value.parentKey !== "string" || typeof value.payload !== "string") return;
          const values = chunks.get(value.parentKey) || [];
          values[value.index] = value.payload;
          chunks.set(value.parentKey, values);
        });
        const records = new Map();
        roots.forEach((root, key) => {
          if (root.deleted) {
            records.set(key, { kind: root.recordKind, id: root.id, updatedAt: Number(root.updatedAt) || 0, deleted: true });
            return;
          }
          let data = root.data;
          if (root.chunkCount) {
            const parts = chunks.get(key) || [];
            if (parts.length !== root.chunkCount || parts.some(part => typeof part !== "string")) {
              throw new Error(`Ù…Ù‚Ø§Ø·Ø¹ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø³Ø­Ø§Ø¨ÙŠØ© Ù„Ù„Ø³Ø¬Ù„ ${root.id} ØºÙŠØ± Ù…ÙƒØªÙ…Ù„Ø©Ø› Ø³ÙŠØ­Ø§ÙˆÙ„ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø© Ù…Ø¬Ø¯Ø¯Ù‹Ø§.`);
            }
            try { data = JSON.parse(parts.join("")); }
            catch (error) {
              console.error("Could not parse a chunked Firebase record:", error);
              throw new Error(`ØªØ¹Ø°Ø± ÙÙƒ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø³Ø¬Ù„ Ø§Ù„Ø³Ø­Ø§Ø¨ÙŠ ${root.id}.`);
            }
          }
          if (!data || typeof data !== "object") throw new Error(`Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø³Ø¬Ù„ Ø§Ù„Ø³Ø­Ø§Ø¨ÙŠ ${root.id} ØºÙŠØ± ØµØ§Ù„Ø­Ø©.`);
          records.set(key, {
            kind: root.recordKind, id: root.id, data,
            updatedAt: Number(root.updatedAt) || 0, deleted: false, chunkCount: Number(root.chunkCount) || 0
          });
        });
        return records;
      }
      function setCloudRecordInMap(records, key, record) {
        if (record.kind === "lead") {
          if (record.deleted) records.delete(key);
          else records.set(key, { kind: record.kind, id: record.id, data: record.data });
          return;
        }
        if (record.kind === "meta") {
          if (record.deleted) records.delete(key);
          else records.set(key, { kind: record.kind, id: record.id, data: record.data });
          return;
        }
        if (!cloudCollections.includes(record.kind)) return;
        if (record.deleted) records.delete(key);
        else records.set(key, { kind: record.kind, id: record.id, data: record.data });
      }
      function applyCloudRecordsToLocal(records) {
        const previousLeadData = localStorage.getItem(STORAGE_KEY);
        const previousAppData = localStorage.getItem(APP_STATE_KEY);
        const previousLeads = leads;
        const previousState = appState;
        const nextRecords = [...records.values()];
        const getCollection = kind => nextRecords.filter(record => record.kind === kind).map(record => record.data);
        const meta = nextRecords.find(record => record.kind === "meta")?.data || {};
        cloudApplyingRemote = true;
        try {
          cloudCollections.forEach(kind => { appState[kind] = getCollection(kind); });
          appState.cleanerBatchRuns = Math.max(0, Number(meta.cleanerBatchRuns) || 0);
          appState.cleanerRows = Array.isArray(meta.cleanerRows) ? meta.cleanerRows : [];
          appState.rawContacts = typeof meta.rawContacts === "string" ? meta.rawContacts : "";
          appState.cleanerPreferences = meta.cleanerPreferences || null;
          appState.lastCleanerStats = meta.lastCleanerStats || { duplicates: 0, invalid: 0, batches: 0 };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
          localStorage.setItem(APP_STATE_KEY, JSON.stringify(appState));
        } catch (error) {
          leads = previousLeads;
          appState = previousState;
          try {
            if (previousLeadData === null) localStorage.removeItem(STORAGE_KEY);
            else localStorage.setItem(STORAGE_KEY, previousLeadData);
            if (previousAppData === null) localStorage.removeItem(APP_STATE_KEY);
            else localStorage.setItem(APP_STATE_KEY, previousAppData);
          } catch (restoreError) {
            console.error("Could not restore local data after a failed cloud merge:", restoreError);
          }
          console.error("Could not apply Firebase records to local storage:", error);
          showToast("ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„ØªÙŠ ÙˆØµÙ„Øª Ù…Ù† Firebase Ù…Ø­Ù„ÙŠÙ‹Ø§. Ø£ÙØ±Øº Ù…Ø³Ø§Ø­Ø© Ù…Ù† Ø§Ù„Ù…ØªØµÙØ­ Ø«Ù… Ø£Ø¹Ø¯ Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø©.");
          return false;
        } finally {
          cloudApplyingRemote = false;
        }
        lastLocalRecords = serializeCloudRecords(collectLocalCloudRecords());
        persistCloudSyncMetadata();
        renderLeads();
        populateAppointmentClients();
        renderAppointments();
        renderArchive();
        renderAnalytics();
        renderLookup();
        renderScripts();
        if (typeof runCleaner === "function" && appState.rawContacts) runCleaner(false, false);
        lastLocalRecords = serializeCloudRecords(collectLocalCloudRecords());
        return true;
      }
      async function reconcileCloudRecords(remoteRecords) {
        const localRecords = collectLocalCloudRecords();
        const mergedRecords = new Map(localRecords);
        const keys = new Set([
          ...localRecords.keys(),
          ...remoteRecords.keys(),
          ...Object.keys(cloudSyncMetadata.tombstones)
        ]);
        const pushKeys = new Set();
        keys.forEach(key => {
          const local = localRecords.get(key);
          const remote = remoteRecords.get(key);
          const localVersion = Number(cloudSyncMetadata.versions[key]) || 0;
          const tombstoneVersion = Number(cloudSyncMetadata.tombstones[key]) || 0;
          const effectiveLocalVersion = Math.max(localVersion, tombstoneVersion);
          if (remote) {
            const pendingWrite = cloudQueuedKeys.has(key) || cloudWritingKeys.has(key);
            const remoteMatchesLocal = local
              ? !remote.deleted && JSON.stringify(local.data) === JSON.stringify(remote.data)
              : Boolean(remote.deleted);
            if (pendingWrite && remoteMatchesLocal) {
              cloudSyncMetadata.versions[key] = remote.updatedAt;
              delete cloudSyncMetadata.tombstones[key];
              cloudQueuedKeys.delete(key);
              setCloudRecordInMap(mergedRecords, key, remote);
              return;
            }
            if (effectiveLocalVersion > remote.updatedAt || pendingWrite) {
              if (pendingWrite) {
                const nextVersion = Math.max(effectiveLocalVersion, remote.updatedAt + 1);
                if (local) cloudSyncMetadata.versions[key] = nextVersion;
                else cloudSyncMetadata.tombstones[key] = nextVersion;
              }
              pushKeys.add(key);
              return;
            }
            cloudSyncMetadata.versions[key] = remote.updatedAt;
            delete cloudSyncMetadata.tombstones[key];
            setCloudRecordInMap(mergedRecords, key, remote);
            return;
          }
          if (local) {
            if (!cloudSyncMetadata.versions[key]) {
              cloudSyncMetadata.versions[key] = Math.max(Date.now(), effectiveLocalVersion + 1);
            }
            pushKeys.add(key);
          } else if (tombstoneVersion) {
            pushKeys.add(key);
          }
        });
        if (!applyCloudRecordsToLocal(mergedRecords)) return;
        cloudRemoteRecords = remoteRecords;
        await pushCloudRecords(pushKeys);
      }
      async function writeCloudRecord(key, record, version, deleted) {
        const collection = cloudRecordsPath();
        const rootReference = collection.doc(key);
        const previous = cloudRemoteRecords.get(key);
        const batch = cloudDb.batch();
        for (let index = 0; index < (previous?.chunkCount || 0); index++) {
          batch.delete(collection.doc(cloudChunkId(key, index)));
        }
        const root = {
          key, recordKind: record?.kind || previous?.kind || "unknown",
          id: record?.id || previous?.id || key,
          updatedAt: version, deleted: Boolean(deleted), chunkCount: 0
        };
        if (!deleted && record) {
          const payload = JSON.stringify(record.data);
          if (new TextEncoder().encode(payload).length > 600000) {
            const parts = splitCloudPayload(payload);
            root.chunkCount = parts.length;
            parts.forEach((part, index) => {
              batch.set(collection.doc(cloudChunkId(key, index)), {
                kind: "chunk", recordKind: record.kind, parentKey: key, index, payload: part, updatedAt: version
              });
            });
          } else root.data = record.data;
        }
        if (!root.chunkCount && previous) {
          const update = { ...root };
          if (deleted) update.data = window.firebase.firestore.FieldValue.delete();
          try {
            await rootReference.update(update);
          } catch (error) {
            if (error.code !== "not-found") throw error;
            await rootReference.set(root);
          }
          if ((previous.chunkCount || 0) > 0) {
            for (let start = 0; start < previous.chunkCount; start += 450) {
              const cleanupBatch = cloudDb.batch();
              const end = Math.min(previous.chunkCount, start + 450);
              for (let index = start; index < end; index++) {
                cleanupBatch.delete(collection.doc(cloudChunkId(key, index)));
              }
              await cleanupBatch.commit();
            }
          }
        } else {
          batch.set(rootReference, root);
          await batch.commit();
        }
        if (deleted) cloudRemoteRecords.set(key, { kind: root.recordKind, id: root.id, updatedAt: version, deleted: true, chunkCount: 0 });
        else cloudRemoteRecords.set(key, { ...record, updatedAt: version, deleted: false, chunkCount: root.chunkCount });
      }
      async function pushCloudRecords(onlyKeys) {
        onlyKeys.forEach(key => cloudQueuedKeys.add(key));
        if (!cloudQueuedKeys.size) return;
        if (!cloudUser || cloudAccountMismatch || !cloudDb) return;
        if (!navigator.onLine) {
          setCloudStatus("Ø£ÙˆÙÙ„Ø§ÙŠÙ† Â· Ø§Ù„ØªØºÙŠÙŠØ±Ø§Øª Ù…Ø­ÙÙˆØ¸Ø© Ù…Ø­Ù„ÙŠÙ‹Ø§", "pending");
          return;
        }
        if (!cloudInitialServerSnapshot) {
          setCloudStatus("Ø¬Ø§Ø±Ù ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ø³Ø­Ø§Ø¨ÙŠØ© Ù‚Ø¨Ù„ Ø§Ù„Ø¯Ù…Ø¬â€¦", "pending");
          return;
        }
        if (cloudSyncInProgress) {
          return;
        }
        cloudSyncInProgress = true;
        setCloudStatus("Ø¬Ø§Ø±ÙŠ Ø­ÙØ¸ Ø§Ù„ØªØºÙŠÙŠØ±Ø§Øª Ø§Ù„Ø³Ø­Ø§Ø¨ÙŠØ©â€¦", "pending");
        let writingKeys = [];
        let syncFailed = false;
        try {
          while (cloudQueuedKeys.size && navigator.onLine) {
            writingKeys = [...cloudQueuedKeys];
            writingKeys.forEach(key => cloudQueuedKeys.delete(key));
            writingKeys.forEach(key => cloudWritingKeys.add(key));
            const localRecords = new Map([...collectLocalCloudRecords()].map(([key, value]) => [
              key, { ...value, data: JSON.parse(JSON.stringify(value.data)) }
            ]));
            for (const key of writingKeys) {
              const local = localRecords.get(key);
              const tombstoneVersion = Number(cloudSyncMetadata.tombstones[key]) || 0;
              let version = Math.max(Number(cloudSyncMetadata.versions[key]) || 0, tombstoneVersion);
              const remote = cloudRemoteRecords.get(key);
              const remoteMatchesLocal = remote && (local
                ? !remote.deleted && JSON.stringify(local.data) === JSON.stringify(remote.data)
                : remote.deleted);
              if (remoteMatchesLocal) continue;
              if (remote && remote.updatedAt >= version) {
                version = remote.updatedAt + 1;
                if (local) cloudSyncMetadata.versions[key] = version;
                else cloudSyncMetadata.tombstones[key] = version;
                if (!persistCloudSyncMetadata()) throw new Error("ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø¥ØµØ¯Ø§Ø± Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø© Ø§Ù„Ø¬Ø¯ÙŠØ¯ Ù…Ø­Ù„ÙŠÙ‹Ø§ Ù‚Ø¨Ù„ Ø¥Ø±Ø³Ø§Ù„Ù‡.");
              }
              await writeCloudRecord(key, local, version || Date.now(), !local);
            }
            writingKeys.forEach(key => cloudWritingKeys.delete(key));
            writingKeys = [];
          }
          cloudLastError = "";
          if (!cloudQueuedKeys.size) {
            setCloudStatus(`ðŸŸ¢ Ù…ØªØ²Ø§Ù…Ù† Â· ${cloudUser.email || "Ø§Ù„Ø­Ø³Ø§Ø¨"}`, "synced");
            byId("cloud-account-status").textContent = `ØªÙ… Ø­ÙØ¸ Ø§Ù„ØªØºÙŠÙŠØ±Ø§Øª ÙÙŠ Ø­Ø³Ø§Ø¨ ${cloudUser.email || cloudUser.uid}.`;
          }
          persistCloudSyncMetadata();
        } catch (error) {
          syncFailed = true;
          writingKeys.forEach(key => {
            cloudWritingKeys.delete(key);
            cloudQueuedKeys.add(key);
          });
          cloudLastError = error.message || "ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª ÙÙŠ Firebase.";
          console.error("Firebase cloud sync failed:", error);
          setCloudStatus("ØªØ¹Ø°Ø± Ø§Ù„Ø­ÙØ¸ Ø§Ù„Ø³Ø­Ø§Ø¨ÙŠ Â· Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø­Ù„ÙŠØ© Ù…Ø­ÙÙˆØ¸Ø©", "error");
          byId("cloud-account-status").textContent = `ØªØ¹Ø°Ø± Ø§Ù„Ø­ÙØ¸ ÙÙŠ Firebase: ${cloudLastError}`;
        } finally {
          cloudSyncInProgress = false;
          if (cloudQueuedKeys.size && cloudUser && !cloudAccountMismatch) {
            if (!syncFailed && navigator.onLine && cloudInitialServerSnapshot) void pushCloudRecords(new Set());
            else if (!syncFailed) setCloudStatus("ØªØºÙŠÙŠØ±Ø§Øª Ù…Ø­ÙÙˆØ¸Ø© Ù…Ø­Ù„ÙŠÙ‹Ø§ Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ø§Ù„Ø§ØªØµØ§Ù„ Ø§Ù„Ø³Ø­Ø§Ø¨ÙŠ", "pending");
          }
        }
      }
      function scheduleCloudSync(changedKeys = new Set()) {
        if (!cloudUser || !changedKeys.size) return;
        setCloudStatus(navigator.onLine ? "ðŸŸ  ØªÙˆØ¬Ø¯ ØªØºÙŠÙŠØ±Ø§Øª Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø©" : "Ø£ÙˆÙÙ„Ø§ÙŠÙ† Â· Ø§Ù„ØªØºÙŠÙŠØ±Ø§Øª Ù…Ø­ÙÙˆØ¸Ø© Ù…Ø­Ù„ÙŠÙ‹Ø§", "pending");
        void pushCloudRecords(changedKeys);
      }
      function updateCloudAccountUi() {
        const signedIn = Boolean(cloudUser);
        if (!signedIn) {
          byId("cloud-login").textContent = signupMode ? "Ø¥Ù†Ø´Ø§Ø¡ Ø­Ø³Ø§Ø¨ Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø©" : "ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„";
          byId("cloud-register").textContent = signupMode ? "Ø§Ù„Ø¹ÙˆØ¯Ø© Ù„ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„" : "Ø¥Ù†Ø´Ø§Ø¡ Ø­Ø³Ø§Ø¨ Ù…ÙˆØ¸Ù";
          byId("cloud-password").autocomplete = signupMode ? "new-password" : "current-password";
        }
        byId("cloud-login").hidden = signedIn;
        byId("cloud-register").hidden = signedIn;
        byId("cloud-create-admin").hidden = signedIn;
        byId("signup-full-name-wrap").hidden = signedIn || !signupMode;
        byId("cloud-full-name").required = !signedIn && signupMode;
        byId("cloud-sync-now").hidden = !signedIn;
        byId("cloud-sync-now").disabled = signedIn && (cloudAccountMismatch || !cloudInitialServerSnapshot);
        byId("cloud-sign-out").hidden = !signedIn;
        byId("cloud-email").disabled = signedIn;
        byId("cloud-password").disabled = signedIn;
        if (signedIn) byId("cloud-account-status").textContent = `Ù…Ø³Ø¬Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ø¨Ø§Ø³Ù… ${activeSession.email || cloudUser.email || cloudUser.uid}.`;
      }
      async function initializeCloudSync() {
        const rawConfig = localStorage.getItem(FIREBASE_CONFIG_KEY);
        let config = DEFAULT_FIREBASE_CONFIG;
        try {
          if (rawConfig) config = JSON.parse(rawConfig);
          if (!config || typeof config !== "object" || Array.isArray(config) ||
              ["apiKey", "authDomain", "projectId", "appId"].some(key => typeof config[key] !== "string" || !config[key].trim())) {
            throw new Error("ÙŠØ¬Ø¨ ØªÙˆÙÙŠØ± apiKey ÙˆauthDomain ÙˆprojectId ÙˆappId ØµØ§Ù„Ø­ÙŠÙ†.");
          }
        }
        catch (error) {
          console.error("Firebase configuration is invalid:", error);
          setCloudStatus("Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Firebase ØºÙŠØ± ØµØ§Ù„Ø­Ø©", "error");
          byId("cloud-account-status").textContent = `ØªØ¹Ø°Ø± Ù‚Ø±Ø§Ø¡Ø© Ø¥Ø¹Ø¯Ø§Ø¯ Firebase: ${error.message}. Ø£Ø²Ù„ Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯ Ø§Ù„Ø§Ø®ØªÙŠØ§Ø±ÙŠ Ø£Ùˆ Ø§Ø­ÙØ¸ JSON ØµØ§Ù„Ø­Ù‹Ø§.`;
          return false;
        }
        if (!window.firebase?.initializeApp || !window.firebase?.firestore || !window.firebase?.functions) {
          setCloudStatus("Ø­Ø²Ù… Firebase ØºÙŠØ± Ù…ØªØ§Ø­Ø©", "error");
          byId("cloud-account-status").textContent = "ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ø­Ø²Ù… Firebase Authentication ÙˆFirestore ÙˆFunctions. ØªØ­Ù‚Ù‚ Ù…Ù† Ø§ØªØµØ§Ù„ Ø§Ù„Ø¥Ù†ØªØ±Ù†Øª.";
          return false;
        }
        const firebaseApps = window.firebase.apps || [];
        const existingApp = firebaseApps.find(app => app.name === "[DEFAULT]");
        if (existingApp && Object.entries(config).some(([key, value]) => existingApp.options[key] !== value)) {
          byId("cloud-account-status").textContent = "ØªØºÙŠÙ‘Ø±Øª Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Firebase. Ø£Ø¹Ø¯ ØªØ­Ù…ÙŠÙ„ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ Ù‚Ø¨Ù„ Ù…Ø­Ø§ÙˆÙ„Ø© Ø§Ù„Ø§ØªØµØ§Ù„ Ø¨Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ø¬Ø¯ÙŠØ¯Ø©.";
          setCloudStatus("ÙŠØªØ·Ù„Ø¨ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„ØªØ­Ù…ÙŠÙ„ Ù„ØªØºÙŠÙŠØ± Ø§Ù„Ù…Ø´Ø±ÙˆØ¹", "error");
          return false;
        }
        cloudApp = existingApp || window.firebase.initializeApp(config);
        cloudAuth = cloudApp.auth();
        cloudDb = null;
        try {
          const firestoreModule = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
          if (typeof firestoreModule.initializeFirestore !== "function" ||
              typeof firestoreModule.persistentLocalCache !== "function") {
            throw new Error("Modern Firestore cache APIs are unavailable.");
          }
          try {
            firestoreModule.initializeFirestore(cloudApp, {
              cache: firestoreModule.persistentLocalCache({
                tabManager: typeof firestoreModule.persistentMultipleTabManager === "function"
                  ? firestoreModule.persistentMultipleTabManager()
                  : undefined
              })
            });
          } catch (cacheError) {
            // initializeFirestore throws when Firestore has already been started
            // for this app; treat that as non-fatal and continue.
            if (!/already (been )?started|already exists/i.test(String(cacheError?.message || cacheError?.code || ""))) {
              throw cacheError;
            }
          }
        } catch (moduleError) {
          console.error("Could not initialize modern Firestore persistent cache:", moduleError);
          throw moduleError;
        }
        cloudDb = cloudApp.firestore();

        cloudFunctions = cloudApp.functions("us-central1");
        if (!cloudInitPromise) {
          cloudInitPromise = new Promise(resolve => {
            cloudAuth.onAuthStateChanged(async user => {
              const previousUser = cloudUser;
              if (previousUser && previousUser.uid !== user?.uid) {
                stopCompanySessionListeners();
                if (userProfileListener) userProfileListener();
                userProfileListener = null;
                authSessionGeneration++;
                activeSession = { uid: "", email: "", role: "", companyId: "", authType: "", ready: false };
              }
              cloudUser = user;
              if (!user) signupMode = false;
              cloudAccountMismatch = false;
              updateCloudAccountUi();
              if (user && signupInProgress) {
                resolve(true);
                return;
              }
              if (!user) {
                stopCompanySessionListeners();
                if (userProfileListener) userProfileListener();
                userProfileListener = null;
                authSessionGeneration++;
                activeSession = { uid: "", email: "", role: "", companyId: "", authType: "", ready: false };
                cloudRemoteRecords.clear();
                cloudInitialServerSnapshot = false;
                companyInitialServerSnapshot = false;
                teamProfiles = [];
                companySettings = normalizeCompanySettings();
                metaPreviewLead = null;
                hideApprovalScreen();
                if (previousUser) {
                  leads = [];
                  companyActions = [];
                  companyLeadRecords.clear();
                  companyLeadCacheKey = "";
                  try { localStorage.setItem(STORAGE_KEY, "[]"); }
                  catch (error) { console.error("Could not clear the signed-in CRM view:", error); }
                }
                refreshSessionUi();
                setCloudStatus(navigator.onLine ? "Firebase Ø¬Ø§Ù‡Ø² Â· Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù„Ù„Ù…Ø²Ø§Ù…Ù†Ø©" : "Ø£ÙˆÙÙ„Ø§ÙŠÙ† Â· Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ù…Ø­ÙÙˆØ¸Ø© Ù…Ø­Ù„ÙŠÙ‹Ø§", navigator.onLine ? "local" : "pending");
                byId("cloud-account-status").textContent = navigator.onLine
                  ? "Ø¥Ø¹Ø¯Ø§Ø¯ Firebase Ø¬Ø§Ù‡Ø². Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù„Ù„Ø¨Ø¯Ø¡ Ø¨Ù…Ø²Ø§Ù…Ù†Ø© Ø¨ÙŠØ§Ù†Ø§Øª Ù‡Ø°Ø§ Ø§Ù„Ø¬Ù‡Ø§Ø²."
                  : "Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ø§ØªØµØ§Ù„ Ø¨Ø§Ù„Ø¥Ù†ØªØ±Ù†Øª. Ø¨ÙŠØ§Ù†Ø§ØªÙƒ Ù…Ø­ÙÙˆØ¸Ø© Ù…Ø­Ù„ÙŠÙ‹Ø§ ÙˆØ³ØªØªÙ… Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø© Ø¨Ø¹Ø¯ ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„ ÙˆØ¹ÙˆØ¯Ø© Ø§Ù„Ø§ØªØµØ§Ù„.";
                resolve(true);
                return;
              }
              if (!cloudDb) {
                resolve(false);
                return;
              }
              if (user.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL) {
                if (!user.emailVerified) {
                  hideApprovalScreen();
                  refreshSessionUi();
                  byId("cloud-account-status").textContent = "ØªØ­Ù‚Ù‚ Ù…Ù† Ø¨Ø±ÙŠØ¯ Ø§Ù„Ù…Ø¯ÙŠØ± Ø§Ù„Ø£Ø³Ø§Ø³ÙŠ Ø¹Ø¨Ø± Ø±Ø§Ø¨Ø· Firebase Ø«Ù… Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù…Ø¬Ø¯Ø¯Ù‹Ø§. Ù„Ù† ÙŠÙØ¹Ø±Ø¶ Ø­Ø³Ø§Ø¨ Ø§Ù„Ù…Ø¯ÙŠØ± ÙƒØ·Ù„Ø¨ Ù…Ø¹Ù„Ù‚.";
                  resolve(true);
                  return;
                }
                let primaryProfile;
                try { primaryProfile = await cloudDb.collection("users").doc(user.uid).get({ source: "server" }); }
                catch (error) {
                  console.error("Could not load the primary administrator profile:", error);
                  hideApprovalScreen();
                  refreshSessionUi();
                  byId("cloud-account-status").textContent = `ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ù…Ù„Ù Ø§Ù„Ù…Ø¯ÙŠØ± Ù…Ø¤Ù‚ØªÙ‹Ø§: ${error.message || error.code}. Ø£Ø¹Ø¯ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ø¨Ø¹Ø¯ Ø¹ÙˆØ¯Ø© Ø§Ù„Ø§ØªØµØ§Ù„.`;
                  resolve(true);
                  return;
                }
                if (!primaryProfile.exists) {
                  hideApprovalScreen();
                  refreshSessionUi();
                  byId("cloud-account-status").textContent = "Ø£Ø¯Ø®Ù„ ÙƒÙ„Ù…Ø© Ù…Ø±ÙˆØ± Ø§Ù„Ù…Ø¯ÙŠØ± ÙˆØ³Ø¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù„Ø¥ÙƒÙ…Ø§Ù„ Ø§Ù„ØªÙ‡ÙŠØ¦Ø© Ø§Ù„Ø¯Ø§Ø¦Ù…Ø© Ù„Ø£ÙˆÙ„ Ù…Ø±Ø©.";
                  resolve(true);
                  return;
                }
                hideApprovalScreen();
                void cloudFunctions.httpsCallable("bootstrapPrimaryAdmin")({}).catch(error => {
                  console.error("Primary administrator profile maintenance failed:", error);
                });
                attachUserProfileListener(user);
                resolve(true);
                return;
              }
              blockCompanySession({ role: "pending", status: "pending" },
                "Ø¬Ø§Ø±Ù Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† Ù…ÙˆØ§ÙÙ‚Ø© Ø§Ù„Ø­Ø³Ø§Ø¨ Ù‚Ø¨Ù„ ÙØªØ­ Ù…Ø³Ø§Ø­Ø© Ø§Ù„Ø¹Ù…Ù„.");
              attachUserProfileListener(user);
              resolve(true);
            }, error => {
              console.error("Firebase authentication state listener failed:", error);
              setCloudStatus("ØªØ¹Ø°Ø± Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† Ø¬Ù„Ø³Ø© Firebase", "error");
              byId("cloud-account-status").textContent = `ØªØ¹Ø°Ø± Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„: ${error.message || error.code}.`;
              resolve(false);
            });
          });
        }
        return cloudInitPromise;
      }
      function attachCloudListener() {
        if (!cloudUser || !cloudDb) return;
        if (cloudListener) cloudListener();
        cloudInitialServerSnapshot = false;
        updateCloudAccountUi();
        setCloudStatus("Ø¬Ø§Ø±Ù Ø§Ù„Ø§ØªØµØ§Ù„ Ø¨Ù€ Firebaseâ€¦", "pending");
        const recordsQuery = activeSession.role === "agent"
          ? cloudRecordsPath().where("recordKind", "in", ["appointments", "customScripts"]).limit(100)
          : cloudRecordsPath().limit(100);
        cloudListener = recordsQuery.onSnapshot({ includeMetadataChanges: true }, snapshot => {
          if (snapshot.metadata?.fromCache && navigator.onLine) {
            setCloudStatus("Ø¬Ø§Ø±Ù ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ø³Ø­Ø§Ø¨ÙŠØ©â€¦", "pending");
            return;
          }
          if (!snapshot.metadata?.fromCache) {
            cloudInitialServerSnapshot = true;
            updateCloudAccountUi();
          }
          try {
            const remoteRecords = decodeCloudSnapshot(snapshot);
            if (activeSession.role === "admin") {
              remoteRecords.forEach(record => {
                if (record.kind === "lead" && !record.deleted && record.data && !record.data.companyId) {
                  legacyCloudLeadRecords.set(record.id, {
                    ...record.data, companyId: activeSession.companyId,
                    batchId: record.data.batchId || record.data.sourceBatchId || "",
                    batchName: record.data.batchName || (record.data.sourceBatchId ? "Ø¯ÙØ¹Ø© CRM" : "")
                  });
                }
              });
            }
            cloudMergeQueue = cloudMergeQueue.then(() => reconcileCloudRecords(remoteRecords)).catch(error => {
              console.error("Could not merge Firebase changes:", error);
              setCloudStatus("ØªØ¹Ø°Ø±Øª Ù…Ø·Ø§Ø¨Ù‚Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø³Ø­Ø§Ø¨ÙŠØ©", "error");
              byId("cloud-account-status").textContent = error.message || "ØªØ¹Ø°Ø±Øª Ù…Ø·Ø§Ø¨Ù‚Ø© Ø¨ÙŠØ§Ù†Ø§Øª Firebase.";
            });
          } catch (error) {
            console.error("Could not read Firebase records:", error);
            setCloudStatus("ØªØ¹Ø°Ø± Ù‚Ø±Ø§Ø¡Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø³Ø­Ø§Ø¨ÙŠØ©", "error");
            byId("cloud-account-status").textContent = error.message || "ØªØ¹Ø°Ø± ÙÙƒ Ø³Ø¬Ù„Ø§Øª Firebase.";
          }
        }, error => {
          console.error("Firebase real-time listener failed:", error);
          cloudLastError = error.message || "ØªØ¹Ø°Ø± Ø§Ù„Ø§ØªØµØ§Ù„ Ø¨Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª.";
          setCloudStatus("ØªØ¹Ø°Ø± Ø§Ù„Ø§ØªØµØ§Ù„ Ø¨Ù€ Firebase", "error");
          byId("cloud-account-status").textContent = `ØªØ¹Ø°Ø± ÙØªØ­ Ù…Ø³Ø§Ø± Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø³Ø§Ø¨: ${cloudLastError}`;
        });
      }
      byId("cloud-sync-open").addEventListener("click", () => {
        byId("firebase-config").value = localStorage.getItem(FIREBASE_CONFIG_KEY) || "";
        updateCloudAccountUi();
        if (!byId("cloud-sync-dialog").open) byId("cloud-sync-dialog").showModal();
      });
      byId("close-cloud-dialog").addEventListener("click", () => byId("cloud-sync-dialog").close());
      byId("cloud-config-form").addEventListener("submit", async event => {
        event.preventDefault();
        const rawConfig = byId("firebase-config").value.trim();
        try {
          if (rawConfig) {
            const config = JSON.parse(rawConfig);
            if (!config || typeof config !== "object" || Array.isArray(config) ||
                ["apiKey", "authDomain", "projectId", "appId"].some(key => typeof config[key] !== "string" || !config[key].trim())) {
              throw new Error("ÙŠØ¬Ø¨ Ø¥Ø¯Ø®Ø§Ù„ apiKey ÙˆauthDomain ÙˆprojectId ÙˆappId Ù…Ù† Ø¥Ø¹Ø¯Ø§Ø¯ ØªØ·Ø¨ÙŠÙ‚ Firebase Web.");
            }
            localStorage.setItem(FIREBASE_CONFIG_KEY, JSON.stringify(config));
          } else {
            localStorage.removeItem(FIREBASE_CONFIG_KEY);
          }
        } catch (error) {
          byId("cloud-account-status").textContent = `Ø¥Ø¹Ø¯Ø§Ø¯ ØºÙŠØ± ØµØ§Ù„Ø­: ${error.message}`;
          setCloudStatus("Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Firebase ØºÙŠØ± ØµØ§Ù„Ø­Ø©", "error");
          return;
        }
        try {
          if (!await initializeCloudSync()) return;
          byId("cloud-account-status").textContent = rawConfig
            ? "Ø­ÙÙØ¸ Ø¥Ø¹Ø¯Ø§Ø¯ Firebase Ø§Ù„Ù…Ø®ØµØµ Ø¹Ù„Ù‰ Ù‡Ø°Ø§ Ø§Ù„Ø¬Ù‡Ø§Ø²."
            : "ØªÙ…Øª Ø§Ø³ØªØ¹Ø§Ø¯Ø© Ø¥Ø¹Ø¯Ø§Ø¯ Firebase Ø§Ù„Ù…Ø¶Ù…Ù‘Ù† ÙÙŠ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚.";
          showToast(rawConfig ? "ØªÙ… Ø­ÙØ¸ Ø¥Ø¹Ø¯Ø§Ø¯ Firebase Ø§Ù„Ù…Ø®ØµØµ." : "ØªÙ…Øª Ø§Ø³ØªØ¹Ø§Ø¯Ø© Ø¥Ø¹Ø¯Ø§Ø¯ Firebase Ø§Ù„Ø§ÙØªØ±Ø§Ø¶ÙŠ.");
        } catch (error) {
          console.error("Could not initialize the configured Firebase project:", error);
          byId("cloud-account-status").textContent = `ØªØ¹Ø°Ø± ØªÙ‡ÙŠØ¦Ø© Firebase: ${error.message || error.code}.`;
          setCloudStatus("ØªØ¹Ø°Ø± ØªÙ‡ÙŠØ¦Ø© Firebase", "error");
        }
      });
      byId("cloud-login-form").addEventListener("submit", async event => {
        event.preventDefault();
        const email = byId("cloud-email").value.trim().toLowerCase();
        const password = byId("cloud-password").value;
        if (signupMode) {
          const fullName = byId("cloud-full-name").value.trim();
          if (fullName.length < 2) {
            byId("cloud-full-name").setCustomValidity("Ø£Ø¯Ø®Ù„ Ø§Ù„Ø§Ø³Ù… Ø§Ù„ÙƒØ§Ù…Ù„.");
            byId("cloud-full-name").reportValidity();
            return;
          }
          byId("cloud-full-name").setCustomValidity("");
          signupInProgress = true;
          try {
            if (!await initializeCloudSync() || !cloudAuth || !cloudFunctions) throw new Error("ØªØ¹Ø°Ø± ØªÙ‡ÙŠØ¦Ø© Firebase.");
            await cloudAuth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
            if (password.length < 12) throw new Error("ÙŠØ¬Ø¨ Ø£Ù† ØªØªÙƒÙˆÙ† ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± Ù…Ù† 12 Ø­Ø±ÙÙ‹Ø§ Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„.");
            const result = await cloudFunctions.httpsCallable("registerEmployee")({ email, fullName, password });
            if (!result.data?.token) throw new Error("Ù„Ù… ÙŠÙØ±Ø¬Ø¹ Ø®Ø§Ø¯Ù… Ø§Ù„ØªØ³Ø¬ÙŠÙ„ Ø¬Ù„Ø³Ø© Ø¯Ø®ÙˆÙ„ ØµØ§Ù„Ø­Ø©.");
            await cloudAuth.signInWithCustomToken(result.data.token);
            signupInProgress = false;
            signupMode = false;
            byId("cloud-password").value = "";
            updateCloudAccountUi();
            if (cloudAuth.currentUser) attachUserProfileListener(cloudAuth.currentUser);
            byId("cloud-account-status").textContent = "ØªÙ… Ø¥Ø±Ø³Ø§Ù„ Ø·Ù„Ø¨ Ø§Ù†Ø¶Ù…Ø§Ù… Ø§Ù„Ù…ÙˆØ¸Ù. ØªØ¸Ù„ Ù…Ø³Ø§Ø­Ø© Ø§Ù„Ø¹Ù…Ù„ Ù…Ø¹Ù„Ù‚Ø© Ø­ØªÙ‰ Ù…ÙˆØ§ÙÙ‚Ø© Ø§Ù„Ù…Ø¯ÙŠØ±.";
          } catch (error) {
            signupInProgress = false;
            console.error("Firebase employee registration failed:", error);
            updateCloudAccountUi();
            hideApprovalScreen();
            refreshSessionUi();
            byId("cloud-account-status").textContent = `ØªØ¹Ø°Ø± Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„Ø·Ù„Ø¨: ${error.message || error.code}.`;
            setCloudStatus("ØªØ¹Ø°Ø± Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„Ø­Ø³Ø§Ø¨", "error");
          }
          return;
        }
        try {
          if (!await initializeCloudSync() || !cloudAuth || !cloudFunctions) throw new Error("Ø§Ø­ÙØ¸ Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Firebase Ø£ÙˆÙ„Ù‹Ø§.");
          await cloudAuth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
          let nativeCredential = null;
          let nativeError = null;
          try {
            nativeCredential = await cloudAuth.signInWithEmailAndPassword(email, password);
          } catch (error) {
            nativeError = error;
            const credentialErrors = new Set([
              "auth/invalid-credential", "auth/invalid-login-credentials",
              "auth/user-not-found", "auth/wrong-password", "auth/invalid-email"
            ]);
            if (!credentialErrors.has(error.code)) throw error;
          }
          if (nativeCredential && email === PRIMARY_ADMIN_EMAIL) {
            if (!nativeCredential.user.emailVerified) {
              await nativeCredential.user.sendEmailVerification();
              await cloudAuth.signOut();
              throw new Error("ØªØ­Ù‚Ù‚ Ù…Ù† Ø¨Ø±ÙŠØ¯ Ø§Ù„Ù…Ø¯ÙŠØ± Ø¹Ø¨Ø± Ø§Ù„Ø±Ø§Ø¨Ø· Ø§Ù„Ù…Ø±Ø³Ù„ Ø«Ù… Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù…Ø¬Ø¯Ø¯Ù‹Ø§.");
            }
            try {
              await cloudFunctions.httpsCallable("bootstrapPrimaryAdmin")({ password });
            } catch (error) {
              console.error("Primary administrator setup needs another attempt:", error);
              byId("cloud-account-status").textContent = `ØªÙ… ØªØ³Ø¬ÙŠÙ„ Ø¯Ø®ÙˆÙ„ Ø§Ù„Ù…Ø¯ÙŠØ±ØŒ Ù„ÙƒÙ† ØªØ¹Ø°Ø±Øª Ù…Ø²Ø§Ù…Ù†Ø© ØªÙ‡ÙŠØ¦Ø© Ø§Ù„Ø´Ø±ÙƒØ©: ${error.message || error.code}.`;
            }
            attachUserProfileListener(nativeCredential.user);
          } else if (!nativeCredential) {
            const employeeLogin = await cloudFunctions.httpsCallable("loginEmployee")({ email, password });
            if (!employeeLogin.data?.token) throw nativeError || new Error("Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø£Ùˆ ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± ØºÙŠØ± ØµØ­ÙŠØ­ÙŠÙ†.");
            await cloudAuth.signInWithCustomToken(employeeLogin.data.token);
          }
          byId("cloud-password").value = "";
          await enableNotificationsAfterLogin();
          byId("cloud-account-status").textContent = "ØªÙ… ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„Ø› Ø¬Ø§Ø±Ù ØªØ­Ù…ÙŠÙ„ Ù…Ù„Ù Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… ÙˆØµÙ„Ø§Ø­ÙŠØ§Øª Ø§Ù„Ø´Ø±ÙƒØ©.";
        } catch (error) {
          console.error("Firebase sign-in failed:", error);
          byId("cloud-account-status").textContent = `ØªØ¹Ø°Ø± ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„: ${error.message || error.code}. ØªØ­Ù‚Ù‚ Ù…Ù† Ø§Ù„Ø¨Ø±ÙŠØ¯ ÙˆÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± ÙˆØ§ØªØµØ§Ù„ Ø®Ø¯Ù…Ø© Firebase.`;
          setCloudStatus("ÙØ´Ù„ ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„", "error");
        }
      });
      byId("cloud-register").addEventListener("click", () => {
        signupMode = !signupMode;
        byId("cloud-login").textContent = signupMode ? "Ø¥Ù†Ø´Ø§Ø¡ Ø­Ø³Ø§Ø¨ Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø©" : "ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„";
        byId("cloud-register").textContent = signupMode ? "Ø§Ù„Ø¹ÙˆØ¯Ø© Ù„ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„" : "Ø¥Ù†Ø´Ø§Ø¡ Ø­Ø³Ø§Ø¨ Ù…ÙˆØ¸Ù";
        byId("cloud-password").autocomplete = signupMode ? "new-password" : "current-password";
        byId("signup-full-name-wrap").hidden = !signupMode;
        byId("cloud-full-name").required = signupMode;
        if (!signupMode) byId("cloud-full-name").value = "";
      });
      byId("cloud-create-admin").addEventListener("click", async () => {
        signupMode = false;
        byId("cloud-full-name").required = false;
        byId("signup-full-name-wrap").hidden = true;
        updateCloudAccountUi();
        const email = byId("cloud-email").value.trim().toLowerCase();
        const password = byId("cloud-password").value;
       if (!email || email.trim() === "") {
          showToast("ÙŠØ±Ø¬Ù‰ Ø¥Ø¯Ø®Ø§Ù„ Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ Ø¨Ø´ÙƒÙ„ ØµØ­ÙŠØ­.");
          return;
        }
        if (password.length <6 ) {
          showToast("Ø§Ø³ØªØ®Ø¯Ù… ÙƒÙ„Ù…Ø© Ù…Ø±ÙˆØ± Ù…Ù† 6 Ø­Ø±ÙÙ‹Ø§ Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„.");
          return;
        }
        try {
          if (!await initializeCloudSync() || !cloudAuth) throw new Error("ØªØ¹Ø°Ø± ØªÙ‡ÙŠØ¦Ø© Firebase.");
          await cloudAuth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
          const credential = await cloudAuth.createUserWithEmailAndPassword(email, password);
          await credential.user.sendEmailVerification();
          await cloudAuth.signOut();
          byId("cloud-password").value = "";
          byId("cloud-account-status").textContent = "Ø£ÙØ±Ø³Ù„ Ø±Ø§Ø¨Ø· Ø§Ù„ØªØ­Ù‚Ù‚ Ø¥Ù„Ù‰ Ø¨Ø±ÙŠØ¯ Ø§Ù„Ù…Ø¯ÙŠØ±. Ø§ÙØªØ­ Ø§Ù„Ø±Ø§Ø¨Ø· Ø«Ù… Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù„Ø¥Ù†Ø´Ø§Ø¡ ØµÙ„Ø§Ø­ÙŠØ§Øª Ø§Ù„Ù…Ø¯ÙŠØ± Ø§Ù„Ø¯Ø§Ø¦Ù…Ø©.";
          showToast("ØªØ­Ù‚Ù‚ Ù…Ù† Ø¨Ø±ÙŠØ¯ Ø§Ù„Ù…Ø¯ÙŠØ± Ø§Ù„Ø£Ø³Ø§Ø³ÙŠ Ù„Ø¥ÙƒÙ…Ø§Ù„ Ø§Ù„ØªÙ‡ÙŠØ¦Ø©.");
        } catch (error) {
          console.error("Primary administrator account setup failed:", error);
          byId("cloud-account-status").textContent = `ØªØ¹Ø°Ø± Ø¥Ù†Ø´Ø§Ø¡ Ø­Ø³Ø§Ø¨ Ø§Ù„Ù…Ø¯ÙŠØ±: ${error.message || error.code}. Ø¥Ø°Ø§ ÙƒØ§Ù† Ø§Ù„Ø­Ø³Ø§Ø¨ Ù…ÙˆØ¬ÙˆØ¯Ù‹Ø§ Ø¨Ø§Ù„ÙØ¹Ù„ØŒ Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ø¨Ø¹Ø¯ ØªØ£ÙƒÙŠØ¯ Ø§Ù„Ø¨Ø±ÙŠØ¯.`;
        }
      });
      byId("cloud-sign-out").addEventListener("click", async () => {
        try {
          stopAlert();
          if (cloudAuth) await cloudAuth.signOut();
          byId("cloud-account-status").textContent = "ØªÙ… ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø®Ø±ÙˆØ¬Ø› ØªØ¸Ù„ Ø¨ÙŠØ§Ù†Ø§Øª Ù‡Ø°Ø§ Ø§Ù„Ø¬Ù‡Ø§Ø² Ù…Ø­ÙÙˆØ¸Ø© Ù…Ø­Ù„ÙŠÙ‹Ø§.";
          setCloudStatus("ØªÙ… ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø®Ø±ÙˆØ¬ Â· Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ù…Ø­Ù„ÙŠØ©", "local");
        } catch (error) {
          console.error("Firebase sign-out failed:", error);
          byId("cloud-account-status").textContent = `ØªØ¹Ø°Ø± ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø®Ø±ÙˆØ¬: ${error.message || error.code}.`;
          setCloudStatus("ØªØ¹Ø°Ø± ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø®Ø±ÙˆØ¬", "error");
        }
      });
      byId("approval-sign-out").addEventListener("click", async () => {
        try {
          stopAlert();
          if (cloudAuth) await cloudAuth.signOut();
        } catch (error) {
          console.error("Could not sign out a pending or disabled user:", error);
          showToast(`ØªØ¹Ø°Ø± ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø®Ø±ÙˆØ¬: ${error.message || error.code}.`);
        }
      });
      byId("approval-check").addEventListener("click", () => {
        if (cloudUser && cloudDb) attachUserProfileListener(cloudUser);
      });
      byId("cloud-sync-now").addEventListener("click", () => {
        if (!cloudUser) { showToast("Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ø£ÙˆÙ„Ù‹Ø§ Ù„Ù…Ø²Ø§Ù…Ù†Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª."); return; }
        pushCloudRecords(new Set([
          ...collectLocalCloudRecords().keys(),
          ...Object.keys(cloudSyncMetadata.tombstones)
        ]));
        if (activeSession.ready) {
          attachCompanyLeadsListener();
          void flushPendingCompanySettings();
          pendingCompanyLeadIds.forEach(id => {
            const lead = leads.find(item => item.id === id);
            if (lead && !companyLeadWriteQueues.has(id)) void writeCompanyLead(lead).catch(() => {});
          });
          void flushPendingLeadActions();
        }
      });
      window.addEventListener("online", () => {
        if (!cloudUser) {
          setCloudStatus("Firebase Ø¬Ø§Ù‡Ø² Â· Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù„Ù„Ù…Ø²Ø§Ù…Ù†Ø©", "local");
          return;
        }
        setCloudStatus("Ø¹Ø§Ø¯ Ø§Ù„Ø§ØªØµØ§Ù„ Â· Ø¬Ø§Ø±Ù Ù…Ø²Ø§Ù…Ù†Ø© Ø§Ù„ØªØºÙŠÙŠØ±Ø§Øª", "pending");
        attachCloudListener();
        if (activeSession.ready) {
          attachCompanyLeadsListener();
          void flushPendingCompanySettings();
          void flushPendingLeadActions();
        }
      });
      window.addEventListener("offline", () => {
        if (cloudUser) setCloudStatus("Ø£ÙˆÙÙ„Ø§ÙŠÙ† Â· Ø§Ù„ØªØºÙŠÙŠØ±Ø§Øª Ù…Ø­ÙÙˆØ¸Ø© Ù…Ø­Ù„ÙŠÙ‹Ø§", "pending");
      });

      function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
          "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[char]);
      }

      function arabicDate(date = new Date()) {
        return new Intl.DateTimeFormat("ar-EG", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(date);
      }
      byId("today-label").textContent = arabicDate();

      function switchTab(tabName) {
        if (cloudUser && !activeSession.ready) return;
        if (tabName === "admin" && (!activeSession.ready || activeSession.role !== "admin")) tabName = "crm";
        if (activeSession.ready && activeSession.role === "agent" && !EMPLOYEE_ALLOWED_TABS.has(tabName)) tabName = "crm";
        document.querySelectorAll(".tab-button").forEach(button => {
          const selected = button.dataset.tab === tabName;
          button.classList.toggle("active", selected);
          button.setAttribute("aria-selected", String(selected));
          button.tabIndex = selected ? 0 : -1;
        });
        document.querySelectorAll(".tab-panel").forEach(panel => {
          const selected = panel.id === `panel-${tabName}`;
          panel.classList.toggle("active", selected);
          panel.hidden = !selected;
        });
        if (tabName === "analytics") renderAnalytics();
        if (tabName === "scheduler") renderAppointments();
        if (tabName === "archive") renderArchive();
        if (tabName === "actions") renderPipeline();
        if (tabName === "admin") renderAdminDashboard();
      }

      document.querySelectorAll(".tab-button").forEach((button, index, buttons) => {
        button.addEventListener("click", () => switchTab(button.dataset.tab));
        button.addEventListener("keydown", event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const visibleButtons = Array.from(buttons).filter(item => !item.hidden);
          const currentIndex = visibleButtons.indexOf(button);
          const targetIndex = event.key === "Home" ? 0 : event.key === "End" ? visibleButtons.length - 1 :
            (currentIndex + (event.key === "ArrowLeft" ? 1 : -1) + visibleButtons.length) % visibleButtons.length;
          visibleButtons[targetIndex].focus();
          switchTab(visibleButtons[targetIndex].dataset.tab);
        });
        document.querySelectorAll("[data-open-tab]").forEach(button => {
          button.addEventListener("click", () => {
            switchTab(button.dataset.openTab);
            byId(`tab-${button.dataset.openTab}`).focus();
            window.scrollTo({ top: 0, behavior: "smooth" });
          });
        });
      });

      const interestLabels = {
        hot: { label: "Hot", emoji: "ðŸ”¥", cls: "hot" },
        warm: { label: "Warm", emoji: "â˜€ï¸", cls: "warm" },
        cold: { label: "Cold", emoji: "â„ï¸", cls: "cold" }
      };

      const phoneRegions = {
        EG: { code: "20", validate: value => /^1[0125]\d{8}$/.test(value), stripTrunk: true },
        SA: { code: "966", validate: value => /^5\d{8}$/.test(value), stripTrunk: true },
        AE: { code: "971", validate: value => /^5\d{8}$/.test(value), stripTrunk: true },
        QA: { code: "974", validate: value => /^[3567]\d{7}$/.test(value), stripTrunk: true },
        KW: { code: "965", validate: value => /^[4569]\d{7}$/.test(value), stripTrunk: true },
        BH: { code: "973", validate: value => /^[36]\d{7}$/.test(value), stripTrunk: true },
        OM: { code: "968", validate: value => /^[79]\d{7}$/.test(value), stripTrunk: true }
      };
      function normalizePhone(input, selectedRegion = "auto") {
        const arabicDigits = String(input ?? "").replace(/[Ù -Ù©Û°-Û¹]/g, digit => {
          const code = digit.charCodeAt(0);
          return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
        });
        let digits = arabicDigits.replace(/\D/g, "");
        if (digits.startsWith("00")) digits = digits.slice(2);
        let region = selectedRegion;
        if (region === "auto") {
          region = Object.keys(phoneRegions).find(key => digits.startsWith(phoneRegions[key].code) && digits.length > phoneRegions[key].code.length + 5);
          if (region) digits = digits.slice(phoneRegions[region].code.length);
          else {
            region = "EG";
            if (digits.startsWith("20")) digits = digits.slice(2);
          }
        } else if (digits.startsWith(phoneRegions[region].code) && digits.length > phoneRegions[region].code.length + 5) {
          digits = digits.slice(phoneRegions[region].code.length);
        }
        const rules = phoneRegions[region];
        if (!rules) return null;
        if (rules.stripTrunk && digits.startsWith("0")) digits = digits.slice(1);
        if (!rules.validate(digits)) return null;
        return `+${rules.code}${digits}`;
      }

      const leadStatuses = {
        new: "Ø¬Ø¯ÙŠØ¯", contacted: "ØªÙ… Ø§Ù„ØªÙˆØ§ØµÙ„", visited: "ØªÙ…Øª Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©",
        reserved: "Ø­Ø¬Ø² Ù…Ø¨Ø¯Ø¦ÙŠ", won: "ØªÙ… Ø§Ù„Ø¥ØºÙ„Ø§Ù‚", lost: "ØºÙŠØ± Ù…Ù‡ØªÙ…", callback: "Ø¥Ø¹Ø§Ø¯Ø© Ø§ØªØµØ§Ù„", completed: "Ù…ÙƒØªÙ…Ù„ â­"
      };

      function leadCardHTML(lead, locked = false) {
        const interest = interestLabels[lead.interest] || interestLabels.warm;
        const waNumber = String(lead.phone || "").replace(/\D/g, "").replace(/^00/, "");
        const templateText = (template, subjectLead = lead) => String(template || "")
          .replace(/\{name\}/g, subjectLead.name || "")
          .replace(/\{project\}/g, subjectLead.project || "Ø§Ù„Ø¹Ù‚Ø§Ø±");
        const waUrl = `https://wa.me/${encodeURIComponent(waNumber)}?text=${encodeURIComponent(templateText(companySettings.whatsappTemplate))}`;
        const mailSubject = templateText(companySettings.emailSubject);
        const mailBody = templateText(companySettings.emailTemplate);
        const dialNumber = String(lead.phone || "").replace(/[^\d+]/g, "");
        const disabled = locked || !canModifyLead(lead) ? "disabled" : "";
        const statusClass = lead.completed ? "completed" : lead.vip ? "vip" : (lead.status === "lost" || lead.archived ? "rejected" : ["contacted", "visited", "reserved", "callback"].includes(lead.status) ? "followup" : lead.status === "won" ? "won" : "new");
        const statusLabel = leadStatuses[lead.status] || leadStatuses.new;
        const details = [
          ["Ø§Ù„Ù‡Ø§ØªÙ", (lead.phones || [lead.phone]).filter(Boolean).join(" Â· "), true], ["Ø¬Ù‡Ø© Ø§Ù„Ø¹Ù…Ù„", lead.company, false],
          ["Ø§Ù„Ù…Ø³Ù…Ù‰ Ø§Ù„ÙˆØ¸ÙŠÙÙŠ", lead.jobTitle, false], ["Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ", lead.email, true],
          ["Ø§Ù„Ù…ÙˆÙ‚Ø¹", lead.location, false], ["Ø§Ù„Ù…Ø´Ø±ÙˆØ¹", lead.project, false]
        ].filter(([, value]) => value);
        return `<article class="lead-card ${lead.vip ? "is-vip" : ""} ${lead.completed ? "is-complete" : ""} ${lead.archived ? "is-archived" : ""}" data-lead-card="${escapeHTML(lead.id)}">
          <div class="lead-card-head"><div><div class="lead-card-name">${escapeHTML(lead.name || "Ø¨Ø¯ÙˆÙ† Ø§Ø³Ù…")}</div>
            <div class="lead-card-tags"><span class="interest ${interest.cls}">${interest.emoji} ${interest.label}</span>
              <span class="lead-status-badge lead-status-${statusClass}">${escapeHTML(statusLabel)}</span>
              ${lead.completed ? '<span class="tag-label">â­ Ù…ÙƒØªÙ…Ù„ Â· Ù†Ø¬Ù…Ø© ÙˆØ§Ø­Ø¯Ø©</span>' : ""}
              ${lead.vip ? '<span class="tag-label" style="color:#ffd873;border-color:#9c710e">ðŸ‘‘ VIP</span>' : ""}
              ${lead.archived ? '<span class="tag-label">ðŸ“¦ Ù…Ø¤Ø±Ø´Ù Â· ØºÙŠØ± Ù…Ù‡ØªÙ…</span>' : ""}
              ${lead.callLater ? `<span class="tag-label">ðŸ“ž Ø¥Ø¹Ø§Ø¯Ø© Ø§ØªØµØ§Ù„${lead.callbackDate ? ` Â· ${escapeHTML(lead.callbackDate)}` : ""}</span>` : ""}
              ${lead.batchId || lead.sourceBatchId ? `<span class="tag-label">${escapeHTML(lead.batchName || "Ø¯ÙØ¹Ø© CRM")} Â· Ø§Ù„ØºØ±ÙØ© ${integer.format(lead.roomIndex || 1)}</span>` : ""}
            </div>
          </div><button class="btn btn-quiet small-btn" type="button" data-lead-history="${escapeHTML(lead.id)}">Ø³Ø¬Ù„ Ø§Ù„ØªÙØ§Ø¹Ù„Ø§Øª</button></div>
          <div class="lead-detail-grid">${details.map(([label, value, ltr]) => `<div class="lead-detail"${ltr ? ' dir="ltr"' : ""}><span>${label}</span>${escapeHTML(value)}</div>`).join("")}
          ${lead.idNumber ? `<div class="lead-detail" dir="ltr"><span>ID / Ø§Ù„Ù…Ø¹Ø±Ù</span>${escapeHTML(lead.idNumber)}</div>` : ""}
          ${lead.network ? `<div class="lead-detail"><span>Ø´Ø¨ÙƒØ© Ø§Ù„Ù…Ø­Ù…ÙˆÙ„</span>${escapeHTML(lead.network)}</div>` : ""}
          ${lead.date ? `<div class="lead-detail"><span>Ø§Ù„Ù…ØªØ§Ø¨Ø¹Ø©</span>${escapeHTML(lead.date)}</div>` : ""}
          ${lead.notes ? `<div class="lead-detail"><span>Ù…Ù„Ø§Ø­Ø¸Ø§Øª</span>${escapeHTML(lead.notes)}</div>` : ""}</div>
          <div class="lead-actions">
            <button class="btn lead-action-done" data-lead-action="done" data-lead-id="${escapeHTML(lead.id)}" type="button" ${disabled}>${lead.completed ? "â†© Ø¥Ø¹Ø§Ø¯Ø© ÙØªØ­" : "âœ… ØªÙ… Â· â­"}</button>
            <button class="btn lead-action-interest" data-lead-action="interested" data-lead-id="${escapeHTML(lead.id)}" type="button" ${disabled}>ðŸ”¥ Ù…Ù‡ØªÙ…</button>
            <button class="btn lead-action-archive" data-lead-action="not-interested" data-lead-id="${escapeHTML(lead.id)}" type="button" ${disabled}>âŒ ØºÙŠØ± Ù…Ù‡ØªÙ…</button>
            <button class="btn lead-action-vip" data-lead-action="vip" data-lead-id="${escapeHTML(lead.id)}" type="button" ${disabled}>${lead.vip ? "ðŸ‘‘ VIP Ù…ÙØ¹Ù„" : "ðŸ‘‘ Ø¹Ù…ÙŠÙ„ Ù…Ù‡Ù…"}</button>
            <button class="btn lead-action-callback" data-lead-action="callback" data-lead-id="${escapeHTML(lead.id)}" type="button" ${disabled}>ðŸ“ž Ù„Ù… ÙŠØ±Ø¯ / Ù„Ø§Ø­Ù‚Ù‹Ø§</button>
            ${featureEnabled("whatsapp") ? `<a class="btn btn-whatsapp" data-lead-action="whatsapp" data-lead-id="${escapeHTML(lead.id)}" href="${waUrl}" target="_blank" rel="noopener noreferrer" aria-label="ÙˆØ§ØªØ³Ø§Ø¨ ${escapeHTML(lead.name || "")}">ðŸ’¬ ÙˆØ§ØªØ³Ø§Ø¨</a>` : '<span class="module-state">ÙˆØ§ØªØ³Ø§Ø¨ Â· Ù…Ø¹Ø·Ù‘Ù„ Ù…Ù† Ø§Ù„Ø¥Ø¯Ø§Ø±Ø©</span>'}
            ${featureEnabled("voip") ? `<a class="btn btn-secondary" data-lead-action="call" data-lead-id="${escapeHTML(lead.id)}" href="tel:${encodeURIComponent(dialNumber)}">ðŸ“ž Ø§ØªØµØ§Ù„</a>` : ""}
            ${featureEnabled("emailAutomation") && lead.email ? `<a class="btn btn-secondary" data-lead-action="email" data-lead-id="${escapeHTML(lead.id)}" href="mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}">âœ‰ï¸ Ø¨Ø±ÙŠØ¯</a>` : ""}
            ${featureEnabled("invoicing") && !locked && canModifyLead(lead) ? `<button class="btn module-feature-button" data-lead-action="invoice" data-lead-id="${escapeHTML(lead.id)}" type="button">ðŸ§¾ Ø¹Ø±Ø¶ Ø³Ø¹Ø±</button>` : ""}
          </div>${locked ? '<div class="lead-lock-note">ðŸ”’ ØªÙÙØªØ­ Ù‡Ø°Ù‡ Ø§Ù„ØºØ±ÙØ© ØªÙ„Ù‚Ø§Ø¦ÙŠÙ‹Ø§ Ø¨Ø¹Ø¯ Ø¥ÙƒÙ…Ø§Ù„ Ø§Ù„ØºØ±ÙØ© Ø§Ù„Ø³Ø§Ø¨Ù‚Ø©.</div>' : ""}
          ${activeSession.role === "admin" ? `<label class="lead-assign-control"><span>ØªØ¹ÙŠÙŠÙ† Ø§Ù„ÙˆÙƒÙŠÙ„</span><select class="control" data-lead-assign="${escapeHTML(lead.id)}"><option value="">ØºÙŠØ± Ù…Ø¹ÙŠÙ‘Ù† (Ù„Ù„Ù…Ø¯ÙŠØ±)</option>${teamProfiles.map(agent => `<option value="${escapeHTML(agent.uid)}" ${lead.assignedTo === agent.uid ? "selected" : ""}>${escapeHTML(agent.email || agent.displayName || agent.uid)}</option>`).join("")}</select></label>` : ""}
        </article>`;
      }

      function renderLeads() {
        const query = byId("lead-search").value.trim().toLocaleLowerCase();
        const filter = byId("interest-filter").value;
        const statusFilter = byId("lead-status-filter").value;
        const visibleLeads = leads.filter(canViewLead);
        const filtered = visibleLeads.filter(lead => {
          const matchesFilter = filter === "all" || lead.interest === filter;
          const matchesStatus = statusFilter === "all" ||
            (statusFilter === "call-list" ? !lead.archived && lead.status !== "lost" && !lead.completed : statusFilter === "archived" ? Boolean(lead.archived || lead.status === "lost") : (lead.status || "new") === statusFilter);
          const searchable = `${lead.name} ${lead.phone} ${lead.project || ""} ${lead.notes || ""} ${lead.company || ""} ${lead.jobTitle || ""} ${lead.email || ""} ${lead.location || ""} ${leadStatuses[lead.status] || ""}`.toLocaleLowerCase();
          return matchesFilter && matchesStatus && searchable.includes(query);
        }).sort((a, b) => {
          const rank = { hot: 0, warm: 1, cold: 2 };
          return rank[a.interest] - rank[b.interest] || (a.date || "9999").localeCompare(b.date || "9999");
        });

        const cardsContainer = byId("lead-cards");
        const assignedIds = new Set();
        const batches = new Map();
        visibleLeads.filter(lead => lead.sourceBatchId || lead.batchId).forEach(lead => {
          const batchId = lead.batchId || lead.sourceBatchId;
          const bucket = batches.get(batchId) || [];
          bucket.push(lead);
          batches.set(batchId, bucket);
        });
        const batchEntries = new Map((appState.crmBatches || []).map(batch => [batch.id, batch]));
        batches.forEach((records, id) => {
          if (!batchEntries.has(id)) batchEntries.set(id, { id, label: records[0]?.batchName || "Ø¯ÙØ¹Ø© CRM", total: records.length });
        });
        let rendered = "";
        batchEntries.forEach(batch => {
          const records = batches.get(batch.id) || [];
          records.forEach(lead => assignedIds.add(lead.id));
          const rooms = [];
          for (let roomIndex = 1; roomIndex <= Math.ceil((batch.total || records.length) / 10); roomIndex++) {
            const roomRecords = records.filter(lead => Number(lead.roomIndex) === roomIndex).sort((a, b) => Number(a.roomPosition) - Number(b.roomPosition));
            const visible = roomRecords.filter(lead => filtered.includes(lead));
            const doneCount = roomRecords.filter(lead => lead.completed).length;
            const isDone = roomRecords.length === 10 && doneCount === 10;
            if (!visible.length && !isDone) continue;
            const previousRoom = records.filter(lead => Number(lead.roomIndex) === roomIndex - 1);
            const locked = roomIndex > 1 && (previousRoom.length !== 10 || !previousRoom.every(lead => lead.completed));
            const active = !locked && !isDone;
            rooms.push(`<section class="lead-room ${isDone ? "is-done" : active ? "is-active" : "is-locked"}">
              <div class="lead-room-head"><span class="lead-room-title">${isDone ? "âœ…" : locked ? "ðŸ”’" : "ðŸŸ "} Ø§Ù„ØºØ±ÙØ© / Ø§Ù„Ù…Ø³ØªÙˆÙ‰ ${integer.format(roomIndex)}</span>
                <span class="lead-room-status">${integer.format(doneCount)} / ${integer.format(roomRecords.length)} Ù…ÙƒØªÙ…Ù„${isDone ? " Â· 100% DONE" : ""}</span></div>
              <div class="lead-progress"><span style="width:${roomRecords.length ? Math.round(doneCount / roomRecords.length * 100) : 0}%"></span></div>
              <div class="lead-cards">${visible.map(lead => leadCardHTML(lead, locked)).join("")}</div>
            </section>`);
          }
          const completedCount = records.filter(lead => lead.completed).length;
          rendered += `<section class="lead-batch"><header class="lead-batch-head"><div><h3 class="lead-batch-title">${escapeHTML(batch.label || "Ø¯ÙØ¹Ø© CRM")}</h3>
            <div class="lead-batch-meta">${integer.format(completedCount)} / ${integer.format(batch.total || records.length)} Ø¹Ù…ÙŠÙ„ Ù…ÙƒØªÙ…Ù„ Â· ${Math.floor(completedCount / Math.max(1, batch.total || records.length) * 100)}%</div>
          </div><span class="data-badge">${completedCount === (batch.total || records.length) && records.length ? "â­ Ø£ÙØºÙ„Ù‚Øª" : "5 Ù…Ø³ØªÙˆÙŠØ§Øª Ã— 10"}</span></header>
          <div class="lead-rooms">${rooms.join("") || '<div class="table-empty"><strong>Ù„Ø§ ØªÙˆØ¬Ø¯ Ù†ØªØ§Ø¦Ø¬ Ù…Ø·Ø§Ø¨Ù‚Ø©</strong></div>'}</div></section>`;
        });
        const looseLeads = filtered.filter(lead => !assignedIds.has(lead.id));
        if (looseLeads.length) rendered += `<section class="lead-batch"><header class="lead-batch-head"><div><h3 class="lead-batch-title">Ø¹Ù…Ù„Ø§Ø¡ CRM</h3><div class="lead-batch-meta">${integer.format(looseLeads.length)} Ø¹Ù…ÙŠÙ„</div></div></header><div class="lead-cards">${looseLeads.map(lead => leadCardHTML(lead)).join("")}</div></section>`;
        cardsContainer.innerHTML = rendered;
        byId("lead-empty").hidden = filtered.length > 0;
        byId("lead-count-note").textContent = `${integer.format(filtered.length)} Ù…Ù† ${integer.format(visibleLeads.length)} Ø¹Ù…ÙŠÙ„`;
        byId("total-leads").textContent = integer.format(visibleLeads.length);
        byId("hot-leads").textContent = integer.format(visibleLeads.filter(lead => lead.interest === "hot").length);
        const today = localDateInput();
        byId("today-followups").textContent = integer.format(visibleLeads.filter(lead => lead.date === today && !lead.archived && lead.status !== "lost").length);
      }
      function renderPipeline() {
        const visibleLeads = leads.filter(canViewLead);
        const select = {
          rejected: lead => lead.status === "lost" || lead.archived,
          vip: lead => Boolean(lead.vip),
          followup: lead => !lead.completed && ["new", "contacted", "callback", "visited", "reserved"].includes(lead.status || "new"),
          completed: lead => lead.completed || lead.status === "won"
        }[activePipeline];
        const filtered = visibleLeads.filter(select).sort((a, b) =>
          String(b.lastAction?.createdAt || b.updatedAt || "").localeCompare(String(a.lastAction?.createdAt || a.updatedAt || "")));
        byId("pipeline-list").innerHTML = filtered.map(lead => `<article class="activity-card">
          <div class="archive-item-head"><div><strong>${escapeHTML(lead.name || "Ø¨Ø¯ÙˆÙ† Ø§Ø³Ù…")}</strong><span class="lead-status-badge lead-status-${escapeHTML(lead.status === "lost" ? "rejected" : lead.vip ? "vip" : lead.completed ? "completed" : "followup")}">${escapeHTML(leadStatuses[lead.status] || leadStatuses.new)}</span></div><button class="btn btn-quiet small-btn" type="button" data-lead-history="${escapeHTML(lead.id)}">Ø§Ù„Ø³Ø¬Ù„ Ø§Ù„ÙƒØ§Ù…Ù„</button></div>
          <div class="lead-detail-grid"><div class="lead-detail"><span>Ø§Ù„Ù‡Ø§ØªÙ</span>${escapeHTML(lead.phone || "")}</div><div class="lead-detail"><span>Ø§Ù„Ù…Ø´Ø±ÙˆØ¹</span>${escapeHTML(lead.project || "â€”")}</div>
          <div class="lead-detail"><span>Ø¢Ø®Ø± Ø¥Ø¬Ø±Ø§Ø¡</span>${escapeHTML(lead.lastAction?.action || "â€”")}</div><div class="lead-detail"><span>Ø¨ÙˆØ§Ø³Ø·Ø©</span>${escapeHTML(lead.lastAction?.agentName || "â€”")}</div></div>
          <p class="card-caption">${escapeHTML(lead.lastAction?.notes || lead.notes || "Ù„Ø§ ØªÙˆØ¬Ø¯ Ù…Ù„Ø§Ø­Ø¸Ø§Øª ØªÙØ§Ø¹Ù„.")}</p>
        </article>`).join("");
        byId("pipeline-empty").hidden = filtered.length > 0;
      }
      function renderAdminDashboard() {
        if (!activeSession.ready || activeSession.role !== "admin") return;
        const companyLeads = leads.filter(lead => !lead.companyId || lead.companyId === activeSession.companyId);
        const completed = companyLeads.filter(lead => lead.completed || lead.status === "won").length;
        byId("admin-summary").innerHTML = `<article class="summary-card"><span class="summary-label">Ø¹Ù…Ù„Ø§Ø¡ Ø§Ù„Ø´Ø±ÙƒØ©</span><strong class="summary-value">${integer.format(companyLeads.length)}</strong></article>
          <article class="summary-card"><span class="summary-label">ØµÙÙ‚Ø§Øª Ù…ÙƒØªÙ…Ù„Ø©</span><strong class="summary-value">${integer.format(completed)}</strong></article>
          <article class="summary-card"><span class="summary-label">Ù†Ø³Ø¨Ø© Ø§Ù„ØªØ­ÙˆÙŠÙ„</span><strong class="summary-value">${companyLeads.length ? Math.round(completed / companyLeads.length * 100) : 0}%</strong></article>
          <article class="summary-card"><span class="summary-label">ÙˆÙƒÙ„Ø§Ø¡ Ø§Ù„ÙØ±ÙŠÙ‚</span><strong class="summary-value">${integer.format(teamProfiles.length)}</strong></article>`;
        byId("team-agent-list").innerHTML = teamProfiles.length ? teamProfiles.map(agent => {
          const assignedToValues = agent.authType === "shared-company-email" ? [agent.uid] : [agent.uid, agent.email].filter(Boolean);
          const assigned = companyLeads.filter(lead => assignedToValues.includes(lead.assignedTo));
          const conversions = assigned.filter(lead => lead.completed || lead.status === "won").length;
          return `<article class="team-card"><strong>${escapeHTML(agent.fullName || agent.displayName || agent.email || agent.uid)}</strong>
            <span class="card-caption">${escapeHTML(agent.email || agent.uid)}</span>
            <div class="result-stack"><div class="result-row"><span>Ø¹Ù…Ù„Ø§Ø¡ Ù†Ø´Ø·ÙˆÙ†</span><strong>${integer.format(assigned.filter(lead => !lead.completed && lead.status !== "lost").length)}</strong></div>
            <div class="result-row"><span>Ø§Ù„ØªØ­ÙˆÙŠÙ„Ø§Øª</span><strong>${integer.format(conversions)} Â· ${assigned.length ? Math.round(conversions / assigned.length * 100) : 0}%</strong></div></div></article>`;
        }).join("") : '<div class="table-empty">Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ù…ÙˆØ¸ÙÙˆÙ† Ù†Ø´Ø·ÙˆÙ† ÙÙŠ Ø§Ù„Ø´Ø±ÙƒØ©.</div>';
        const batchMap = new Map();
        companyLeads.forEach(lead => {
          const id = lead.batchId || lead.sourceBatchId;
          if (id && !batchMap.has(id)) batchMap.set(id, lead.batchName || "Ø¯ÙØ¹Ø© CRM");
        });
        const batchOptions = [...batchMap].map(([id, name]) => `<option value="${escapeHTML(id)}">${escapeHTML(name)}</option>`).join("");
        const agentOptions = teamProfiles.map(agent => `<option value="${escapeHTML(agent.uid)}">${escapeHTML(agent.email || agent.displayName || agent.uid)}</option>`).join("");
        byId("admin-batch-select").innerHTML = batchOptions || '<option value="">Ù„Ø§ ØªÙˆØ¬Ø¯ Ø¯ÙØ¹Ø§Øª</option>';
        byId("admin-batch-agent").innerHTML = agentOptions || '<option value="">Ù„Ø§ ÙŠÙˆØ¬Ø¯ ÙˆÙƒÙ„Ø§Ø¡</option>';
        byId("admin-add-agent").innerHTML = `<option value="">ØºÙŠØ± Ù…Ø¹ÙŠÙ‘Ù†</option>${agentOptions}`;
        if (featureEnabled("advancedAnalytics")) renderModuleRoi();
      }
      function resolveMetaPath(source, path) {
        return String(path || "").split(".").filter(Boolean).reduce((value, segment) => {
          if (["__proto__", "prototype", "constructor"].includes(segment)) return undefined;
          return value && typeof value === "object" ? value[segment] : undefined;
        }, source);
      }
      function mapMetaLead(source, mapping) {
        const allowedFields = ["name", "phone", "email", "company", "jobTitle", "location", "project"];
        const mapped = {};
        allowedFields.forEach(field => {
          const value = resolveMetaPath(source, mapping[field]);
          if (["string", "number"].includes(typeof value)) mapped[field] = String(value).trim();
        });
        return mapped;
      }
      function previewMetaMapping() {
        try {
          const mapping = JSON.parse(byId("meta-field-mapping").value);
          if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw new Error("Ø®Ø±ÙŠØ·Ø© Ø§Ù„Ø­Ù‚ÙˆÙ„ ÙŠØ¬Ø¨ Ø£Ù† ØªÙƒÙˆÙ† ÙƒØ§Ø¦Ù† JSON.");
          const sample = JSON.parse(byId("meta-sample-json").value);
          if (!sample || typeof sample !== "object" || Array.isArray(sample)) throw new Error("Ø¹ÙŠÙ†Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª ÙŠØ¬Ø¨ Ø£Ù† ØªÙƒÙˆÙ† ÙƒØ§Ø¦Ù† JSON.");
          metaPreviewLead = mapMetaLead(sample, mapping);
          const rows = Object.entries(metaPreviewLead).map(([key, value]) => `${key}: ${value}`);
          byId("meta-mapping-preview").textContent = rows.length ? rows.join("\n") : "Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ù‚ÙŠÙ…. Ø±Ø§Ø¬Ø¹ Ù…Ø³Ø§Ø±Ø§Øª Ø§Ù„Ø­Ù‚ÙˆÙ„ ÙˆØ§Ù„Ø¹ÙŠÙ†Ø©.";
          byId("import-meta-sample").hidden = !featureEnabled("metaLeadAds") || !metaPreviewLead.name || !metaPreviewLead.phone;
          if (!metaPreviewLead.name || !metaPreviewLead.phone) showToast("Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø© ØªØ­ØªØ§Ø¬ Ø­Ù‚Ù„ÙŽÙŠ Ø§Ù„Ø§Ø³Ù… ÙˆØ§Ù„Ù‡Ø§ØªÙ Ù‚Ø¨Ù„ Ø§Ù„Ø§Ø³ØªÙŠØ±Ø§Ø¯.");
        } catch (error) {
          metaPreviewLead = null;
          byId("meta-mapping-preview").textContent = error.message || "ØªØ¹Ø°Ø± ØªØ­Ù„ÙŠÙ„ JSON.";
          byId("import-meta-sample").hidden = true;
          showToast(`ØªØ¹Ø°Ø± Ù…Ø¹Ø§ÙŠÙ†Ø© Ø®Ø±ÙŠØ·Ø© Meta: ${error.message || error}.`);
        }
      }
      function refreshInvoicePreview() {
        const price = Number(byId("invoice-price").value) || 0;
        const downPayment = Number(byId("invoice-down-payment").value) || 0;
        const installments = Number(byId("invoice-installments").value) || 0;
        const remaining = price - downPayment;
        const monthly = installments > 0 ? remaining / installments : remaining;
        byId("invoice-calculation").textContent = `Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠ: ${money.format(price)} Ø¬.Ù… Â· Ø§Ù„Ù…Ù‚Ø¯Ù…: ${money.format(downPayment)} Ø¬.Ù… Â· Ø§Ù„Ù…ØªØ¨Ù‚ÙŠ: ${money.format(remaining)} Ø¬.Ù… Â· Ø§Ù„Ù‚Ø³Ø· Ø§Ù„Ø´Ù‡Ø±ÙŠ Ø§Ù„ØªÙ‚Ø±ÙŠØ¨ÙŠ: ${money.format(monthly)} Ø¬.Ù…`;
        const lead = leads.find(item => item.id === byId("invoice-lead-id").value);
        byId("invoice-preview-customer").textContent = `Ø§Ù„Ø¹Ù…ÙŠÙ„: ${lead?.name || "â€”"} Â· Ø§Ù„Ù‡Ø§ØªÙ: ${lead?.phone || "â€”"}`;
        byId("invoice-preview-details").textContent = `${byId("invoice-project").value || "Ø§Ù„Ù…Ø´Ø±ÙˆØ¹ / Ø§Ù„ÙˆØ­Ø¯Ø©"}\nØ§Ù„Ø³Ø¹Ø±: ${money.format(price)} Ø¬.Ù…\nØ§Ù„Ù…Ù‚Ø¯Ù…: ${money.format(downPayment)} Ø¬.Ù…\n${installments ? `${installments} Ù‚Ø³Ø·Ù‹Ø§ Ø´Ù‡Ø±ÙŠÙ‹Ø§ Ã— ${money.format(monthly)} Ø¬.Ù…` : "Ø§Ù„Ø³Ø¯Ø§Ø¯ Ø§Ù„Ù…ØªØ¨Ù‚ÙŠ Ø­Ø³Ø¨ Ø§Ù„Ø§ØªÙØ§Ù‚"}`;
        byId("invoice-preview-notes").textContent = byId("invoice-notes").value || "";
      }
      function openInvoiceBuilder(lead) {
        if (!featureEnabled("invoicing") || !canModifyLead(lead)) return;
        byId("invoice-lead-id").value = lead.id;
        byId("invoice-lead-label").textContent = `${lead.name || "Ø§Ù„Ø¹Ù…ÙŠÙ„"} Â· ${lead.phone || ""}`;
        byId("invoice-project").value = lead.project || "";
        byId("invoice-price").value = Number(lead.quote?.amount) || "";
        byId("invoice-down-payment").value = Number(lead.quote?.downPayment) || 0;
        byId("invoice-installments").value = Number(lead.quote?.installments) || 0;
        byId("invoice-notes").value = lead.quote?.notes || "";
        refreshInvoicePreview();
        byId("invoice-dialog").showModal();
      }
      function leadPayloadMatches(left, right) {
        const leftData = { ...left };
        const rightData = { ...right };
        delete leftData.updatedAt;
        delete rightData.updatedAt;
        return JSON.stringify(leftData) === JSON.stringify(rightData);
      }
      function renderLeadHistory(entries) {
        byId("lead-history-list").innerHTML = entries.map(entry => `<article class="timeline-entry">
          <strong>${escapeHTML(entry.action || "ØªØ­Ø¯ÙŠØ« Ø§Ù„Ø¹Ù…ÙŠÙ„")}</strong>
          <div class="card-caption">${escapeHTML(entry.agentName || entry.agentEmail || entry.agentId || "Ù…Ø³ØªØ®Ø¯Ù…")} Â· ${escapeHTML(entry.previousStatus || "â€”")} â† ${escapeHTML(entry.status || "â€”")}</div>
          <div>${escapeHTML(entry.notes || "Ø¨Ø¯ÙˆÙ† Ù…Ù„Ø§Ø­Ø¸Ø§Øª")}</div>
          <small class="card-caption">${escapeHTML(entry.createdAt ? new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.createdAt)) : "")}</small>
        </article>`).join("");
        byId("lead-history-empty").hidden = entries.length > 0;
      }
      function openLeadHistory(leadId) {
        const lead = leads.find(item => item.id === leadId && canViewLead(item));
        if (!lead) return;
        if (leadHistoryListener) leadHistoryListener();
        const localEntries = companyActions.filter(entry => entry.leadId === leadId);
        byId("lead-history-title").textContent = `Ø³Ø¬Ù„ ØªÙØ§Ø¹Ù„Ø§Øª ${lead.name || "Ø§Ù„Ø¹Ù…ÙŠÙ„"}`;
        renderLeadHistory(localEntries);
        byId("lead-history-dialog").showModal();
        if (activeSession.ready && cloudDb && navigator.onLine) {
          leadHistoryListener = companyLeadsPath().doc(leadId).collection("actions").orderBy("createdAt", "desc").limit(100)
            .onSnapshot(snapshot => {
              const remote = snapshot.docs.map(document => document.data());
              const remoteIds = new Set(remote.map(entry => entry.id));
              renderLeadHistory([...remote, ...localEntries.filter(entry => !remoteIds.has(entry.id))]
                .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
            }, error => {
              console.error("Could not load lead interaction history:", error);
              showToast(`ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ø³Ø¬Ù„ Ø§Ù„Ø¹Ù…ÙŠÙ„: ${error.message || error.code}.`);
            });
        }
      }
      byId("lead-history-close").addEventListener("click", () => {
        if (leadHistoryListener) leadHistoryListener();
        leadHistoryListener = null;
        byId("lead-history-dialog").close();
      });
      byId("lead-history-dialog").addEventListener("close", () => {
        if (leadHistoryListener) leadHistoryListener();
        leadHistoryListener = null;
      });
      byId("pipeline-list").addEventListener("click", event => {
        const button = event.target.closest("[data-lead-history]");
        if (button) openLeadHistory(button.dataset.leadHistory);
      });
      document.querySelectorAll("[data-pipeline]").forEach(button => button.addEventListener("click", () => {
        activePipeline = button.dataset.pipeline;
        document.querySelectorAll("[data-pipeline]").forEach(tab => tab.classList.toggle("active", tab === button));
        renderPipeline();
      }));
      document.querySelectorAll("[data-admin-panel]").forEach(button => button.addEventListener("click", () => {
        setAdminPanel(button.dataset.adminPanel);
      }));
      byId("pending-user-list").addEventListener("click", event => {
        const preset = event.target.closest("[data-assign-preset]");
        if (preset) {
          const card = preset.closest("[data-managed-user]");
          const countInput = card?.querySelector("[data-assign-count]");
          if (countInput) countInput.value = preset.dataset.assignPreset;
          return;
        }
        const button = event.target.closest("[data-user-action]");
        if (!button) return;
        const userCard = button.closest("[data-managed-user]");
        const uid = userCard?.dataset.managedUser;
        if (!uid) return;
        if (button.dataset.userAction === "approve") {
          const role = userCard.querySelector("[data-user-role]")?.value;
          const assignmentCount = Number(userCard.querySelector("[data-assign-count]")?.value || 0);
          if (!["agent", "admin"].includes(role)) { showToast("Ø§Ø®ØªØ± Ø¯ÙˆØ±Ù‹Ø§ ØµØ§Ù„Ø­Ù‹Ø§ Ù„Ù„Ù…Ø³ØªØ®Ø¯Ù…."); return; }
          if (!Number.isInteger(assignmentCount) || assignmentCount < 0 || assignmentCount > 2000) {
            showToast("Ø£Ø¯Ø®Ù„ Ø¹Ø¯Ø¯ Ø¬Ù‡Ø§Øª Ø§ØªØµØ§Ù„ ØµØ­ÙŠØ­Ù‹Ø§ Ø¨ÙŠÙ† 0 Ùˆ2000.");
            return;
          }
          void updateManagedUser(uid, "approve", { role, assignmentCount }, "ØªÙ… Ø§Ø¹ØªÙ…Ø§Ø¯ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… ÙˆØªÙØ¹ÙŠÙ„ Ø§Ù„Ø­Ø³Ø§Ø¨.");
        } else if (button.dataset.userAction === "reject") {
          void updateManagedUser(uid, "reject", {}, "ØªÙ… Ø±ÙØ¶ Ø·Ù„Ø¨ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… ÙˆØ­Ø¸Ø± Ø§Ù„ÙˆØµÙˆÙ„.");
        }
      });
      byId("active-user-list").addEventListener("click", event => {
        const button = event.target.closest("[data-user-action]");
        if (!button) return;
        const userCard = button.closest("[data-managed-user]");
        const uid = userCard?.dataset.managedUser;
        if (!uid) return;
        if (button.dataset.userAction === "set-role") {
          const role = userCard.querySelector("[data-user-role]")?.value;
          if (!["agent", "admin"].includes(role)) { showToast("Ø§Ø®ØªØ± Ø¯ÙˆØ±Ù‹Ø§ ØµØ§Ù„Ø­Ù‹Ø§ Ù„Ù„Ù…Ø³ØªØ®Ø¯Ù…."); return; }
          void updateManagedUser(uid, "role", { role }, "ØªÙ… ØªØ­Ø¯ÙŠØ« Ø¯ÙˆØ± Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù….");
        } else if (button.dataset.userAction === "disable") {
          if (!window.confirm("Ø³ÙŠÙÙ…Ù†Ø¹ Ù‡Ø°Ø§ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… Ù…Ù† Ø¯Ø®ÙˆÙ„ CRM Ù…Ø¹ Ø§Ù„Ø§Ø­ØªÙØ§Ø¸ Ø¨Ø­Ø³Ø§Ø¨Ù‡ ÙˆØ¨ÙŠØ§Ù†Ø§ØªÙ‡. Ù‡Ù„ ØªØ±ÙŠØ¯ Ø§Ù„Ù…ØªØ§Ø¨Ø¹Ø©ØŸ")) return;
          void updateManagedUser(uid, "disable", {}, "ØªÙ… ØªØ¹Ø·ÙŠÙ„ Ø­Ø³Ø§Ø¨ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù….");
        }
      });
      byId("blocked-user-list").addEventListener("click", event => {
        const button = event.target.closest('[data-user-action="reactivate"]');
        if (!button) return;
        const userCard = button.closest("[data-managed-user]");
        const uid = userCard?.dataset.managedUser;
        const role = userCard?.querySelector("[data-user-role]")?.value;
        if (!uid || !["agent", "admin"].includes(role)) { showToast("Ø§Ø®ØªØ± Ø¯ÙˆØ±Ù‹Ø§ ØµØ§Ù„Ø­Ù‹Ø§ Ù„Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„ØªÙØ¹ÙŠÙ„."); return; }
        void updateManagedUser(uid, "reactivate", { role }, "ØªÙ…Øª Ø¥Ø¹Ø§Ø¯Ø© ØªÙØ¹ÙŠÙ„ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù….");
      });
      byId("admin-notification-list").addEventListener("click", event => {
        if (event.target.closest("[data-open-employee-request]")) navigateToEmployeeRequests();
      });
      byId("open-employees-room").addEventListener("click", navigateToEmployeeRequests);
      byId("stop-alert").addEventListener("click", stopAlert);
      byId("admin-enable-notifications").addEventListener("click", async () => {
        try {
          if ("Notification" in window) {
            const permission = await Notification.requestPermission();
            if (permission !== "granted") {
              showToast("Ù„Ù… ÙŠÙ…Ù†Ø­ Ø§Ù„Ù…ØªØµÙØ­ Ø¥Ø°Ù† Ø§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª.");
              return;
            }
          }
          if (alertAudioContext?.state === "suspended") await alertAudioContext.resume();
          playAlertChime();
          showToast("ØªÙ… ØªÙØ¹ÙŠÙ„ ØµÙˆØª ÙˆØ¥Ø´Ø¹Ø§Ø±Ø§Øª ØªÙ†Ø¨ÙŠÙ‡Ø§Øª Ø§Ù„Ù…Ø¯ÙŠØ±.");
        } catch (error) {
          console.error("Could not enable admin notifications:", error);
          showToast("ØªØ¹Ø°Ø± ØªÙØ¹ÙŠÙ„ ØµÙˆØª Ø£Ùˆ Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ø§Ù„Ù…Ø¯ÙŠØ±.");
        }
      });
      byId("company-module-list").addEventListener("change", async event => {
        const toggle = event.target.closest("[data-company-feature]");
        if (!toggle || activeSession.role !== "admin") return;
        toggle.disabled = true;
        await saveCompanySettings({ features: { [toggle.dataset.companyFeature]: toggle.checked } });
        toggle.disabled = false;
      });
      byId("save-module-templates").addEventListener("click", async () => {
        if (activeSession.role !== "admin") return;
        const saved = await saveCompanySettings({
          whatsappTemplate: byId("module-whatsapp-template").value.trim(),
          emailSubject: byId("module-email-subject").value.trim(),
          emailTemplate: byId("module-email-template").value
        });
        if (saved) showToast("ØªÙ… Ø­ÙØ¸ Ù‚ÙˆØ§Ù„Ø¨ Ø§Ù„Ø´Ø±ÙƒØ©.");
      });
      byId("preview-meta-mapping").addEventListener("click", previewMetaMapping);
      byId("save-meta-settings").addEventListener("click", async () => {
        if (activeSession.role !== "admin") return;
        let mapping;
        try {
          mapping = JSON.parse(byId("meta-field-mapping").value);
          if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw new Error("Ø®Ø±ÙŠØ·Ø© Ø§Ù„Ø­Ù‚ÙˆÙ„ Ù„ÙŠØ³Øª ÙƒØ§Ø¦Ù† JSON.");
          const validFields = new Set(["name", "phone", "email", "company", "jobTitle", "location", "project"]);
          Object.entries(mapping).forEach(([field, path]) => {
            if (!validFields.has(field) || typeof path !== "string" || path.length > 200) throw new Error(`ØªØ¹Ø±ÙŠÙ Ø­Ù‚Ù„ ØºÙŠØ± ØµØ§Ù„Ø­: ${field}`);
          });
          const webhookUrl = byId("meta-webhook-url").value.trim();
          if (webhookUrl && new URL(webhookUrl).protocol !== "https:") throw new Error("ÙŠØ¬Ø¨ Ø£Ù† ÙŠØ³ØªØ®Ø¯Ù… Ø¹Ù†ÙˆØ§Ù† Ø§Ù„Ø®Ø¯Ù…Ø© HTTPS.");
          const saved = await saveCompanySettings({ metaFieldMapping: mapping, metaWebhookUrl: webhookUrl });
          if (saved) showToast("ØªÙ… Ø­ÙØ¸ Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Meta ÙˆØ®Ø±ÙŠØ·Ø© Ø§Ù„Ø­Ù‚ÙˆÙ„.");
        } catch (error) {
          showToast(`ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø¥Ø¹Ø¯Ø§Ø¯ Meta: ${error.message || error}.`);
        }
      });
      byId("import-meta-sample").addEventListener("click", async () => {
        if (!featureEnabled("metaLeadAds") || !metaPreviewLead?.name || !metaPreviewLead?.phone) return;
        if (cloudUser && !activeSession.ready) { showToast("ÙŠÙ„Ø²Ù… ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ø¨Ø­Ø³Ø§Ø¨ Ø´Ø±ÙƒØ© ØµØ§Ù„Ø­ Ù„Ù„Ø§Ø³ØªÙŠØ±Ø§Ø¯."); return; }
        const phone = normalizePhone(metaPreviewLead.phone, "auto");
        if (!phone) { showToast("Ø±Ù‚Ù… Ø§Ù„Ù‡Ø§ØªÙ Ø§Ù„Ù…Ø³ØªØ®Ø±Ø¬ Ù…Ù† Ø§Ù„Ø¹ÙŠÙ†Ø© ØºÙŠØ± ØµØ§Ù„Ø­."); return; }
        const lead = {
          id: makeId("meta-lead"), ...metaPreviewLead, phone,
          project: metaPreviewLead.project || "Meta Lead Ads",
          companyId: activeSession.ready ? activeSession.companyId : "",
          assignedTo: activeSession.role === "agent" ? activeSession.uid : "",
          assignedAgentEmail: activeSession.role === "agent" ? activeSession.email : "",
          interest: "warm", status: "new", date: "", notes: "Ø§Ø³ØªÙŠØ±Ø§Ø¯ Ù…Ø¹Ø§ÙŠÙ†Ø© Meta Lead Ads",
          completed: false, vip: false, archived: false, createdAt: new Date().toISOString(),
          source: "meta-lead-ads"
        };
        leads = [lead, ...leads];
        if (!persistLeads()) { leads = leads.filter(item => item.id !== lead.id); return; }
        renderLeads();
        await writeLeadAudit(lead, "Ø§Ø³ØªÙŠØ±Ø§Ø¯ Meta Lead Ads", "", "Ø£ÙÙ†Ø´Ø¦ Ù…Ù† Ø¹ÙŠÙ†Ø© JSON Ø¨Ø§Ø³ØªØ®Ø¯Ø§Ù… Ø®Ø±ÙŠØ·Ø© Ø§Ù„Ø­Ù‚ÙˆÙ„.");
        showToast("ØªÙ… Ø§Ø³ØªÙŠØ±Ø§Ø¯ Ø§Ù„Ø¹Ù…ÙŠÙ„ Ù…Ù† Ø¹ÙŠÙ†Ø© Meta Ø¥Ù„Ù‰ CRM.");
      });
      byId("invoice-close").addEventListener("click", () => byId("invoice-dialog").close());
      ["invoice-project", "invoice-price", "invoice-down-payment", "invoice-installments", "invoice-notes"].forEach(id => {
        byId(id).addEventListener("input", refreshInvoicePreview);
      });
      byId("invoice-form").addEventListener("submit", async event => {
        event.preventDefault();
        const lead = leads.find(item => item.id === byId("invoice-lead-id").value);
        if (!lead || !featureEnabled("invoicing") || !canModifyLead(lead)) {
          showToast("Ù„Ø§ ØªÙ…Ù„Ùƒ ØµÙ„Ø§Ø­ÙŠØ© Ø¥Ù†Ø´Ø§Ø¡ Ø¹Ø±Ø¶ Ø³Ø¹Ø± Ù„Ù‡Ø°Ø§ Ø§Ù„Ø¹Ù…ÙŠÙ„.");
          return;
        }
        const amount = Number(byId("invoice-price").value);
        const downPayment = Number(byId("invoice-down-payment").value);
        const installments = Number(byId("invoice-installments").value);
        if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(downPayment) || downPayment < 0 ||
            downPayment > amount || !Number.isInteger(installments) || installments < 0) {
          showToast("ØªØ­Ù‚Ù‚ Ù…Ù† Ø§Ù„Ø³Ø¹Ø± ÙˆØ§Ù„Ù…Ù‚Ø¯Ù… ÙˆØ¹Ø¯Ø¯ Ø§Ù„Ø£Ù‚Ø³Ø§Ø·.");
          return;
        }
        const previousQuote = lead.quote;
        lead.quote = {
          id: makeId("quote"), project: byId("invoice-project").value.trim(), amount, downPayment, installments,
          monthlyInstallment: installments ? (amount - downPayment) / installments : amount - downPayment,
          notes: byId("invoice-notes").value.trim(), createdAt: new Date().toISOString(),
          createdBy: activeSession.uid || "local"
        };
        if (!persistLeads()) { lead.quote = previousQuote; return; }
        await writeLeadAudit(lead, "Ø¥Ù†Ø´Ø§Ø¡ Ø¹Ø±Ø¶ Ø³Ø¹Ø±", lead.status || "new",
          `Ø¹Ø±Ø¶ ${lead.quote.project} Ø¨Ù‚ÙŠÙ…Ø© ${money.format(amount)} Ø¬.Ù… Â· Ù…Ù‚Ø¯Ù… ${money.format(downPayment)} Ø¬.Ù… Â· ${installments} Ù‚Ø³Ø·Ù‹Ø§.`);
        document.body.classList.add("print-invoice");
        window.print();
        window.setTimeout(() => document.body.classList.remove("print-invoice"), 1000);
        byId("invoice-dialog").close();
        showToast("ØªÙ… Ø­ÙØ¸ Ø¹Ø±Ø¶ Ø§Ù„Ø³Ø¹Ø±. Ø§Ø®ØªØ± Save as PDF Ù…Ù† Ù†Ø§ÙØ°Ø© Ø§Ù„Ø·Ø¨Ø§Ø¹Ø©.");
      });
      window.addEventListener("afterprint", () => document.body.classList.remove("print-invoice"));
      byId("lead-cards").addEventListener("change", async event => {
        const selector = event.target.closest("[data-lead-assign]");
        if (!selector || activeSession.role !== "admin") return;
        const lead = leads.find(item => item.id === selector.dataset.leadAssign);
        if (!lead) return;
        const previousAssignee = lead.assignedTo || "";
        const previousAssigneeEmail = lead.assignedAgentEmail || "";
        const previousStatus = lead.status || "new";
        lead.assignedTo = selector.value || "";
        lead.assignedAgentEmail = teamProfiles.find(agent => agent.uid === selector.value)?.email || "";
        if (!persistLeads()) {
          lead.assignedTo = previousAssignee;
          lead.assignedAgentEmail = previousAssigneeEmail;
          renderLeads();
          return;
        }
        await writeLeadAudit(lead, "ØªØ¹ÙŠÙŠÙ† / Ø¥Ø¹Ø§Ø¯Ø© ØªØ¹ÙŠÙŠÙ† Ø§Ù„ÙˆÙƒÙŠÙ„", previousStatus, `Ù…Ù† ${previousAssignee || "ØºÙŠØ± Ù…Ø¹ÙŠÙ‘Ù†"} Ø¥Ù„Ù‰ ${lead.assignedTo || "ØºÙŠØ± Ù…Ø¹ÙŠÙ‘Ù†"}`);
        renderLeads();
      });
      byId("admin-assign-batch").addEventListener("click", async () => {
        if (activeSession.role !== "admin") return;
        const batchId = byId("admin-batch-select").value;
        const assignedTo = byId("admin-batch-agent").value;
        if (!batchId || !assignedTo) { showToast("Ø§Ø®ØªØ± Ø¯ÙØ¹Ø© ÙˆÙˆÙƒÙŠÙ„Ù‹Ø§ ØµØ§Ù„Ø­ÙŠÙ†."); return; }
        const agent = teamProfiles.find(item => item.uid === assignedTo);
        const batchLeads = leads.filter(lead => (lead.batchId || lead.sourceBatchId) === batchId);
        const previousAssignments = batchLeads.map(lead => ({
          lead, assignedTo: lead.assignedTo || "", assignedAgentEmail: lead.assignedAgentEmail || ""
        }));
        batchLeads.forEach(lead => { lead.assignedTo = assignedTo; lead.assignedAgentEmail = agent?.email || ""; });
        if (!persistLeads()) {
          previousAssignments.forEach(({ lead, assignedTo: previousAssignedTo, assignedAgentEmail }) => {
            lead.assignedTo = previousAssignedTo;
            lead.assignedAgentEmail = assignedAgentEmail;
          });
          renderLeads();
          return;
        }
        renderLeads();
        await Promise.all(batchLeads.map(lead => writeLeadAudit(lead, "ØªØ¹ÙŠÙŠÙ† Ø¯ÙØ¹Ø©", lead.status || "new", `Ø£ÙØ³Ù†Ø¯Øª Ø§Ù„Ø¯ÙØ¹Ø© Ø¥Ù„Ù‰ ${agent?.email || assignedTo}`)));
        showToast(`ØªÙ… ØªØ¹ÙŠÙŠÙ† ${batchLeads.length} Ø¹Ù…ÙŠÙ„Ù‹Ø§ Ø¥Ù„Ù‰ ${agent?.email || assignedTo}.`);
      });
      byId("admin-add-open").addEventListener("click", () => {
        if (activeSession.role === "admin") byId("admin-add-dialog").showModal();
      });
      byId("admin-add-close").addEventListener("click", () => byId("admin-add-dialog").close());
      byId("admin-add-form").addEventListener("submit", async event => {
        event.preventDefault();
        if (activeSession.role !== "admin") return;
        const batchId = byId("admin-add-batch").value.trim() ? makeId("campaign") : "";
        const batchName = batchId ? `Ø¯ÙØ¹Ø© ÙŠØ¯ÙˆÙŠØ© ${new Date().toLocaleDateString("ar-EG")}` : "";
        const lines = byId("admin-add-batch").value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const entries = lines.length ? lines.map(line => {
          const columns = line.split(/[,;\t]/).map(value => value.trim());
          return { name: columns[0] || "", phone: columns[1] || "", project: columns.slice(2).join(" ") };
        }) : [{ name: byId("admin-add-name").value.trim(), phone: byId("admin-add-phone").value.trim(), project: byId("admin-add-project").value.trim() }];
        if (entries.some(entry => !entry.name || !entry.phone)) { showToast("ØªØ£ÙƒØ¯ Ù…Ù† Ø¥Ø¯Ø®Ø§Ù„ Ø§Ø³Ù… ÙˆØ±Ù‚Ù… Ù‡Ø§ØªÙ ØµØ§Ù„Ø­ÙŠÙ† Ù„ÙƒÙ„ Ø¹Ù…ÙŠÙ„."); return; }
        const assignedTo = byId("admin-add-agent").value || "";
        const agent = teamProfiles.find(item => item.uid === assignedTo);
        const created = [];
        for (const entry of entries) {
          const phone = normalizePhone(entry.phone, "auto");
          if (!phone) { showToast(`Ø±Ù‚Ù… Ø§Ù„Ù‡Ø§ØªÙ ØºÙŠØ± ØµØ§Ù„Ø­: ${entry.phone}`); return; }
          created.push({
            id: makeId("lead"), name: entry.name, phone, project: entry.project || byId("admin-add-project").value.trim(),
            interest: "warm", status: "new", date: "", notes: "", companyId: activeSession.companyId,
            assignedTo, assignedAgentEmail: agent?.email || "", batchId, batchName,
            createdAt: new Date().toISOString(), completed: false, archived: false, vip: false
          });
        }
        const previousLeads = leads;
        leads = [...created, ...leads];
        if (!persistLeads()) { leads = previousLeads; return; }
        renderLeads();
        await Promise.all(created.map(lead => writeLeadAudit(lead, batchId ? "Ø¥Ù†Ø´Ø§Ø¡ Ø¹Ù…ÙŠÙ„ Ø¶Ù…Ù† Ø¯ÙØ¹Ø©" : "Ø¥Ù†Ø´Ø§Ø¡ Ø¹Ù…ÙŠÙ„", "", "Ø£ÙÙ†Ø´Ø¦ Ù…Ù† Ù„ÙˆØ­Ø© Ø§Ù„Ø¥Ø¯Ø§Ø±Ø©.")));
        byId("admin-add-form").reset();
        byId("admin-add-dialog").close();
        showToast(`ØªÙ… Ø¥Ù†Ø´Ø§Ø¡ ${created.length} Ø¹Ù…ÙŠÙ„Ù‹Ø§ ÙˆØ¥Ø³Ù†Ø§Ø¯Ù‡Ù… Ø¨Ù†Ø¬Ø§Ø­.`);
      });
      function maybeCelebrateCompletedBatch(batchId) {
        const batch = appState.crmBatches.find(item => item.id === batchId);
        if (!batch || batch.total !== 50 || batch.celebratedAt) return;
        const records = leads.filter(lead => lead.sourceBatchId === batchId);
        if (records.length !== 50 || !records.every(lead => lead.completed)) return;
        batch.celebratedAt = new Date().toISOString();
        if (!persistAppState()) { delete batch.celebratedAt; return; }
        window.alert("ØªÙ… Ø¥Ù‚ÙØ§Ù„ Ø§Ù„Ø¯ÙØ¹Ø© Ø¨Ù†Ø¬Ø§Ø­! â­");
      }
      function requestLeadDate(title, defaultDate) {
        const dialog = byId("lead-date-dialog");
        const input = byId("lead-action-date");
        if (typeof dialog.showModal !== "function") {
          showToast("Ø§Ù„Ù…ØªØµÙØ­ Ù„Ø§ ÙŠØ¯Ø¹Ù… Ù†Ø§ÙØ°Ø© Ø§Ø®ØªÙŠØ§Ø± Ø§Ù„ØªØ§Ø±ÙŠØ®. Ø­Ø¯Ù‘Ø« Ø§Ù„Ù…ØªØµÙØ­ Ù„Ù„Ù…ØªØ§Ø¨Ø¹Ø©.");
          return Promise.resolve("");
        }
        byId("lead-date-title").textContent = title;
        input.value = defaultDate || localDateInput();
        return new Promise(resolve => {
          leadDateResolver = resolve;
          dialog.showModal();
          input.focus();
        });
      }
      byId("lead-date-form").addEventListener("submit", event => {
        event.preventDefault();
        const input = byId("lead-action-date");
        if (!input.reportValidity()) return;
        const value = input.value;
        byId("lead-date-dialog").close();
        const resolve = leadDateResolver;
        leadDateResolver = null;
        if (resolve) resolve(value);
      });
      byId("cancel-lead-date").addEventListener("click", () => {
        byId("lead-date-dialog").close();
        const resolve = leadDateResolver;
        leadDateResolver = null;
        if (resolve) resolve("");
      });
      byId("lead-cards").addEventListener("click", async event => {
        const historyButton = event.target.closest("[data-lead-history]");
        if (historyButton) {
          openLeadHistory(historyButton.dataset.leadHistory);
          return;
        }
        const button = event.target.closest("[data-lead-action]");
        if (!button || button.disabled) return;
        const lead = leads.find(item => item.id === button.dataset.leadId);
        if (!lead) return;
        if (button.dataset.leadAction === "whatsapp" || button.dataset.leadAction === "email") {
          if (canModifyLead(lead)) void writeLeadAudit(lead, button.dataset.leadAction === "whatsapp" ? "ÙØªØ­ Ù…Ø­Ø§Ø¯Ø«Ø© WhatsApp" : "ÙØªØ­ Ø±Ø³Ø§Ù„Ø© Ø¨Ø±ÙŠØ¯", lead.status || "new");
          return;
        }
        if (button.dataset.leadAction === "call") {
          if (canModifyLead(lead)) void writeLeadAudit(lead, "Ø¨Ø¯Ø¡ Ø§ØªØµØ§Ù„ Ø¹Ø¨Ø± ØªØ·Ø¨ÙŠÙ‚ Ø§Ù„Ù‡Ø§ØªÙ", lead.status || "new", "Ø¨Ø¯Ø¡ Ø§ØªØµØ§Ù„ Ù…Ù† Ø±Ø§Ø¨Ø· telØ› Ù„Ø§ ÙŠØªØ¶Ù…Ù† ØªØ³Ø¬ÙŠÙ„Ù‹Ø§ ØµÙˆØªÙŠÙ‹Ø§.");
          return;
        }
        if (button.dataset.leadAction === "invoice") {
          openInvoiceBuilder(lead);
          return;
        }
        if (!canModifyLead(lead)) {
          showToast("Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ© ØªØ¹Ø¯ÙŠÙ„ Ù‡Ø°Ø§ Ø§Ù„Ø¹Ù…ÙŠÙ„.");
          return;
        }
        const previousLead = { ...lead };
        const previousStatus = lead.status || "new";
        const action = button.dataset.leadAction;
        let appointmentsBeforeCallback = null;
        const appointmentsBeforeAction = appState.appointments.map(item => ({ ...item }));
        let appointmentsChanged = false;
        if (action === "done") {
          lead.completed = !lead.completed;
          lead.completedAt = lead.completed ? new Date().toISOString() : "";
          if (lead.completed) {
            if (lead.status !== "completed") lead.previousStatus = lead.status || "new";
            lead.status = "completed";
            lead.starsEarned = 1;
          } else {
            lead.status = lead.previousStatus || "new";
            delete lead.previousStatus;
            lead.starsEarned = 0;
          }
        } else if (action === "interested") {
          const followupDate = await requestLeadDate(`Ù…ÙˆØ¹Ø¯ Ù…ØªØ§Ø¨Ø¹Ø© Ø§Ù„Ø¹Ù…ÙŠÙ„ ${lead.name}`, lead.date || localDateInput(new Date(Date.now() + 86400000)));
          if (!followupDate) return;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(followupDate) || Number.isNaN(new Date(`${followupDate}T12:00:00`).getTime())) {
            showToast("ØµÙŠØºØ© Ø§Ù„ØªØ§Ø±ÙŠØ® ØºÙŠØ± ØµØ­ÙŠØ­Ø©. Ø§Ø³ØªØ®Ø¯Ù… YYYY-MM-DD.");
            return;
          }
          lead.interest = "hot";
          lead.date = followupDate;
          lead.status = "contacted";
          lead.archived = false;
          lead.callLater = false;
        } else if (action === "not-interested") {
          lead.archived = true;
          lead.status = "lost";
          lead.callLater = false;
          appState.appointments.filter(item => item.clientId === lead.id && !item.done).forEach(item => {
            item.done = true;
            appointmentsChanged = true;
          });
        } else if (action === "vip") {
          lead.vip = !lead.vip;
        } else if (action === "callback") {
          const callbackDate = await requestLeadDate(`Ù…ÙˆØ¹Ø¯ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ø§ØªØµØ§Ù„ Ø¨Ù€ ${lead.name}`, lead.callbackDate || lead.date || localDateInput(new Date(Date.now() + 86400000)));
          if (!callbackDate) return;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(callbackDate) || Number.isNaN(new Date(`${callbackDate}T12:00:00`).getTime())) {
            showToast("ØµÙŠØºØ© Ø§Ù„ØªØ§Ø±ÙŠØ® ØºÙŠØ± ØµØ­ÙŠØ­Ø©. Ø§Ø³ØªØ®Ø¯Ù… YYYY-MM-DD.");
            return;
          }
          lead.callLater = true;
          lead.callbackDate = callbackDate;
          lead.date = callbackDate;
          lead.status = "callback";
          lead.archived = false;
          appointmentsBeforeCallback = appState.appointments.map(item => ({ ...item }));
          const priorAppointment = appState.appointments.find(item => item.id === lead.callbackAppointmentId);
          if (priorAppointment) {
            priorAppointment.date = callbackDate;
            priorAppointment.done = false;
          } else {
            const appointment = {
              id: makeId("appointment"), title: `Ø¥Ø¹Ø§Ø¯Ø© Ø§ØªØµØ§Ù„: ${lead.name}`, clientId: lead.id,
              type: "call", date: callbackDate, time: "10:00", notes: "ØªØ°ÙƒÙŠØ± Ù…Ù† Ø¨Ø·Ø§Ù‚Ø© Ø§Ù„Ø¹Ù…ÙŠÙ„ ÙÙŠ CRM.",
              done: false, createdAt: new Date().toISOString()
            };
            appState.appointments.push(appointment);
            lead.callbackAppointmentId = appointment.id;
          }
          if (!persistAppState()) { appState.appointments = appointmentsBeforeCallback; Object.assign(lead, previousLead); return; }
        } else return;
        if (appointmentsChanged && !persistAppState()) {
          appState.appointments = appointmentsBeforeAction;
          Object.assign(lead, previousLead);
          return;
        }
        if (!persistLeads()) {
          Object.assign(lead, previousLead);
          if (action === "callback" && appointmentsBeforeCallback) {
            appState.appointments = appointmentsBeforeCallback;
            persistAppState(false);
          } else if (appointmentsChanged) {
            appState.appointments = appointmentsBeforeAction;
            persistAppState(false);
          }
          renderLeads();
          return;
        }
        renderLeads();
        populateAppointmentClients();
        renderAppointments();
        renderAnalytics();
        await writeLeadAudit(lead, action, previousStatus,
          action === "callback" ? `Ù…ÙˆØ¹Ø¯ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ø§ØªØµØ§Ù„: ${lead.callbackDate || ""}`
            : action === "interested" ? `Ù…ÙˆØ¹Ø¯ Ø§Ù„Ù…ØªØ§Ø¨Ø¹Ø©: ${lead.date || ""}`
              : action === "vip" ? (lead.vip ? "ØªÙ… ØªÙØ¹ÙŠÙ„ Ø£ÙˆÙ„ÙˆÙŠØ© VIP." : "ØªÙ… Ø¥Ù„ØºØ§Ø¡ Ø£ÙˆÙ„ÙˆÙŠØ© VIP.") : "");
        if (action === "done" && lead.completed) maybeCelebrateCompletedBatch(lead.sourceBatchId);
        const messages = {
          done: lead.completed ? `ØªÙ… ØªØ³Ø¬ÙŠÙ„ ${lead.name} ÙƒÙ…ÙƒØªÙ…Ù„ ÙˆØ­ØµÙ„ Ø¹Ù„Ù‰ â­.` : `ØªÙ…Øª Ø¥Ø¹Ø§Ø¯Ø© ÙØªØ­ ${lead.name}.`,
          interested: `ØªÙ… ØªØµÙ†ÙŠÙ ${lead.name} ÙƒØ¹Ù…ÙŠÙ„ Ù…Ù‡ØªÙ… Ø³Ø§Ø®Ù† ÙˆØªØ­Ø¯ÙŠØ¯ Ù…ÙˆØ¹Ø¯ Ø§Ù„Ù…ØªØ§Ø¨Ø¹Ø©.`,
          "not-interested": `ØªÙ… Ø£Ø±Ø´ÙØ© ${lead.name} ÙˆØ¥Ø²Ø§Ù„ØªÙ‡ Ù…Ù† Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø§ØªØµØ§Ù„ Ø§Ù„Ù†Ø´Ø·Ø©.`,
          vip: lead.vip ? `ØªÙ… ØªÙ…ÙŠÙŠØ² ${lead.name} ÙƒØ¹Ù…ÙŠÙ„ VIP.` : `Ø£Ø²ÙŠÙ„ ØªÙ…ÙŠÙŠØ² VIP Ø¹Ù† ${lead.name}.`,
          callback: `ØªÙ…Øª Ø¥Ø¶Ø§ÙØ© ${lead.name} Ø¥Ù„Ù‰ Ù‚Ø§Ø¦Ù…Ø© Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ø§ØªØµØ§Ù„ ÙˆØ§Ù„ØªÙ†Ø¨ÙŠÙ‡.`
        };
        showToast(messages[action]);
      });

      byId("lead-form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        const data = new FormData(form);
        const name = String(data.get("name") || "").trim();
        const rawPhone = String(data.get("phone") || "").trim();
        const normalizedPhone = normalizePhone(rawPhone, byId("lead-region").value);
        if (!normalizedPhone) {
          byId("lead-phone").setCustomValidity("Ø£Ø¯Ø®Ù„ Ø±Ù‚Ù… Ù…ÙˆØ¨Ø§ÙŠÙ„ Ù…ØµØ±ÙŠ Ø£Ùˆ Ø®Ù„ÙŠØ¬ÙŠ ØµØ­ÙŠØ­Ù‹Ø§ØŒ Ù…Ø¹ Ø±Ù…Ø² Ø§Ù„Ø¯ÙˆÙ„Ø© Ø¹Ù†Ø¯ Ø§Ù„Ø­Ø§Ø¬Ø©.");
          byId("lead-phone").reportValidity();
          return;
        }
        byId("lead-phone").setCustomValidity("");
        if (leads.some(lead => lead.phone === normalizedPhone) && !window.confirm("Ù‡Ø°Ø§ Ø§Ù„Ø±Ù‚Ù… Ù…Ø³Ø¬Ù„ Ø¨Ø§Ù„ÙØ¹Ù„. Ù‡Ù„ ØªØ±ÙŠØ¯ Ø¥Ø¶Ø§ÙØ© Ø³Ø¬Ù„ Ø¹Ù…ÙŠÙ„ Ø¢Ø®Ø± Ø¨Ù†ÙØ³ Ø§Ù„Ø±Ù‚Ù…ØŸ")) return;
        const newLead = {
          id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          name, phone: normalizedPhone, project: String(data.get("project") || "").trim(),
          interest: String(data.get("interest") || "warm"), date: String(data.get("date") || ""),
          status: String(data.get("status") || "new"),
          expectedCommission: Math.max(0, Number(data.get("expectedCommission")) || 0),
          notes: String(data.get("notes") || "").trim(), createdAt: new Date().toISOString(),
          companyId: activeSession.ready ? activeSession.companyId : "",
          assignedTo: activeSession.role === "agent" ? activeSession.uid : "",
          assignedAgentEmail: activeSession.role === "agent" ? activeSession.email : ""
        };
        leads.unshift(newLead);
        if (!persistLeads()) { leads = leads.filter(lead => lead.id !== newLead.id); return; }
        form.reset();
        if (newLead.date) {
          appState.appointments.push({
            id: makeId("appointment"), title: `Ù…Ø¹Ø§ÙŠÙ†Ø© / Ù…ØªØ§Ø¨Ø¹Ø©: ${newLead.name}`,
            clientId: newLead.id, type: "inspection", date: newLead.date,
            time: "10:00", notes: newLead.project, done: false, createdAt: new Date().toISOString()
          });
          persistAppState();
        }
        renderLeads();
        renderAppointments();
        renderAnalytics();
        await writeLeadAudit(newLead, "Ø¥Ù†Ø´Ø§Ø¡ Ø¹Ù…ÙŠÙ„", "", "Ø£ÙØ¶ÙŠÙ Ù…Ù† Ù†Ù…ÙˆØ°Ø¬ CRM.");
        showToast(activeSession.ready ? "ØªÙ… Ø­ÙØ¸ Ø§Ù„Ø¹Ù…ÙŠÙ„ ÙˆÙ…Ø²Ø§Ù…Ù†ØªÙ‡ Ù…Ø¹ Ø§Ù„Ø´Ø±ÙƒØ©." : "ØªÙ… Ø­ÙØ¸ Ø§Ù„Ø¹Ù…ÙŠÙ„ Ø¹Ù„Ù‰ Ù‡Ø°Ø§ Ø§Ù„Ø¬Ù‡Ø§Ø².");
      });
      byId("lead-phone").addEventListener("input", () => byId("lead-phone").setCustomValidity(""));
      byId("lead-search").addEventListener("input", renderLeads);
      byId("interest-filter").addEventListener("change", renderLeads);
      byId("lead-status-filter").addEventListener("change", renderLeads);

      function csvCell(value) {
        const original = String(value ?? "");
        const safe = /^[\s]*[=+\-@]/.test(original) ? `'${original}` : original;
        return `"${safe.replace(/"/g, '""')}"`;
      }
      function addArchiveEntry(entry) {
        const item = { id: makeId("file"), savedAt: new Date().toISOString(), ...entry };
        const previousArchive = appState.archive;
        const previousKnowledge = appState.projectKnowledge;
        appState.archive = [item, ...appState.archive].slice(0, 100);
        const retainedIds = new Set(appState.archive.map(file => file.id));
        appState.projectKnowledge = appState.projectKnowledge.filter(project => retainedIds.has(project.archiveId));
        if (!persistAppState()) {
          appState.archive = previousArchive;
          appState.projectKnowledge = previousKnowledge;
          return false;
        }
        renderArchive();
        renderAnalytics();
        return true;
      }
      function downloadArchiveEntry(entry) {
        let blob;
        if (entry.dataUrl) {
          const [header, payload] = entry.dataUrl.split(",");
          const mime = (header.match(/data:(.*?);/) || [])[1] || entry.mime || "application/octet-stream";
          const binary = atob(payload || "");
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
          blob = new Blob([bytes], { type: mime });
        } else {
          blob = new Blob([entry.content || ""], { type: entry.mime || "text/plain;charset=utf-8" });
        }
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = entry.name || "mjk-file";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      }
      const projectFactLabels = [
        { label: "Ø§Ù„Ø³Ø¹Ø±", pattern: /Ø§Ù„Ø³Ø¹Ø±|price|starting\s+(?:from|at)|(?:EGP|LE|Ø¬Ù†ÙŠÙ‡|Ø¬\.Ù…)/i },
        { label: "Ø§Ù„Ù…Ø³Ø§Ø­Ø©", pattern: /Ø§Ù„Ù…Ø³Ø§Ø­Ø©|Ù…Ø³Ø§Ø­Ø©|area|size|sqm|sq\.?\s*ft|Ù…(?:ØªØ±)?\s*[Â²Ù¢]/i },
        { label: "Ø§Ù„Ø³Ø¯Ø§Ø¯", pattern: /Ø§Ù„Ø³Ø¯Ø§Ø¯|Ù‚Ø³Ø·|Ù…Ù‚Ø¯Ù…|Ø¯ÙØ¹Ø©|installment|payment\s+plan|down\s+payment/i },
        { label: "Ø§Ù„Ù…ÙˆÙ‚Ø¹", pattern: /Ø§Ù„Ù…ÙˆÙ‚Ø¹|Ù…Ø¯ÙŠÙ†Ø©|Ù…Ø­Ø§ÙØ¸Ø©|location|located|district|road|Ø´Ø§Ø±Ø¹/i },
        { label: "Ø§Ù„ØªØ³Ù„ÙŠÙ…", pattern: /Ø§Ù„ØªØ³Ù„ÙŠÙ…|Ø§Ø³ØªÙ„Ø§Ù…|handover|delivery|completion/i },
        { label: "Ø§Ù„Ø®Ø¯Ù…Ø§Øª", pattern: /Ø§Ù„Ø®Ø¯Ù…Ø§Øª|Ù…Ø±Ø§ÙÙ‚|amenities|facilities|clubhouse|security/i }
      ];
      function translateProjectFact(label, line) {
        const value = line.replace(/^\s*[^:ï¼š]{1,60}\s*[:ï¼š]\s*/, "")
          .replace(/^\s*(?:starting\s+price|price|Ø§Ù„Ø³Ø¹Ø±|Ø§Ù„Ù…Ø³Ø§Ø­Ø©|Ù…Ø³Ø§Ø­Ø©|area|size|payment\s+plan|payment|installments?|Ø§Ù„Ø³Ø¯Ø§Ø¯|Ø§Ù„Ù…ÙˆÙ‚Ø¹|location|located\s+in|delivery|handover|Ø§Ù„ØªØ³Ù„ÙŠÙ…|Ø§Ù„Ø®Ø¯Ù…Ø§Øª|amenities|facilities)\s*[-â€“]?\s*/i, "")
          .trim();
        if (label === "Ø§Ù„Ø³Ø¹Ø±") {
          const amount = (value || line).match(/(?:EGP|LE|Ø¬Ù†ÙŠÙ‡(?:\s*Ù…ØµØ±ÙŠ)?|Ø¬\.Ù…)?\s*([\d,]+(?:\.\d+)?)(?:\s*(million|Ù…Ù„ÙŠÙˆÙ†|k|Ø£Ù„Ù))?/i);
          return amount ? `Ø§Ù„Ø³Ø¹Ø±: ${amount[1]}${amount[2] ? ` ${amount[2]}` : ""} Ø¬Ù†ÙŠÙ‡ Ù…ØµØ±ÙŠ` : `Ø§Ù„Ø³Ø¹Ø±: ${value || line}`;
        }
        if (label === "Ø§Ù„Ù…Ø³Ø§Ø­Ø©") {
          const area = (value || line).match(/([\d,.]+)\s*(?:sqm|sq\.?\s*m|Ù…ØªØ±(?:\s*Ù…Ø±Ø¨Ø¹)?|Ù…Â²|Ù…Ù¢)/i)?.[1];
          return area ? `Ø§Ù„Ù…Ø³Ø§Ø­Ø©: ${area} Ù…Â²` : `Ø§Ù„Ù…Ø³Ø§Ø­Ø©: ${value || line}`;
        }
        const translations = [
          [/\bpayment\s+plan\b/gi, "Ø®Ø·Ø© Ø§Ù„Ø³Ø¯Ø§Ø¯"], [/\bdown\s+payment\b/gi, "Ø§Ù„Ù…Ù‚Ø¯Ù…"],
          [/\binstallments?\b/gi, "Ø§Ù„Ø£Ù‚Ø³Ø§Ø·"], [/\byears?\b/gi, "Ø³Ù†ÙˆØ§Øª"],
          [/\bmonths?\b/gi, "Ø´Ù‡ÙˆØ±"], [/\blocation\b/gi, "Ø§Ù„Ù…ÙˆÙ‚Ø¹"],
          [/\bdelivery\b|\bhandover\b/gi, "Ø§Ù„ØªØ³Ù„ÙŠÙ…"], [/\bamenities\b|\bfacilities\b/gi, "Ø§Ù„Ø®Ø¯Ù…Ø§Øª"]
        ];
        const translated = translations.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), value || line);
        return `${label}: ${translated}`;
      }
      function summarizeProjectText(text) {
        const lines = text.split(/\r?\n|(?<=[.!ØŸ])\s+/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
        const points = [];
        projectFactLabels.forEach(({ label, pattern }) => {
          const matches = lines.filter(line => pattern.test(line)).slice(0, 2);
          matches.forEach(line => points.push(translateProjectFact(label, line).slice(0, 240)));
        });
        if (!points.length) points.push(...lines.slice(0, 3).map(line => line.slice(0, 240)));
        return [...new Set(points)].slice(0, 10);
      }
      async function getProjectOcrWorker(onProgress) {
        if (!window.Tesseract?.createWorker) throw new Error("ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ù…ÙƒØªØ¨Ø© OCR Ù…Ù† CDN. ØªØ­Ù‚Ù‚ Ù…Ù† Ø§ØªØµØ§Ù„ Ø§Ù„Ø¥Ù†ØªØ±Ù†Øª ÙˆØ³ÙŠØ§Ø³Ø© ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ø³ÙƒØ±ÙŠØ¨ØªØ§Øª.");
        if (!ocrWorkerPromise) {
          ocrWorkerPromise = window.Tesseract.createWorker("eng+ara", window.Tesseract.OEM.LSTM_ONLY, {
            workerPath: "https://unpkg.com/tesseract.js@5.0.5/dist/worker.min.js",
            corePath: "https://unpkg.com/tesseract.js-core@5.0.0/tesseract-core-simd-lstm.wasm.js",
            langPath: "https://tessdata.projectnaptha.com/4.0.0/",
            gzip: true,
            cacheMethod: "none",
            workerBlobURL: true,
            logger: message => {
              if (message.status) onProgress(`${message.status}${message.progress ? ` Â· ${Math.round(message.progress * 100)}%` : ""}`);
            }
          }).catch(error => {
            ocrWorkerPromise = null;
            throw error;
          });
        }
        return ocrWorkerPromise;
      }
      async function recognizeProjectImage(image, onProgress) {
        const worker = await getProjectOcrWorker(onProgress);
        const result = await worker.recognize(image);
        return result.data.text;
      }
      async function extractPdfProjectText(file, onProgress) {
        if (!window.pdfjsLib?.getDocument) throw new Error("ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ù…ÙƒØªØ¨Ø© PDF Ù…Ù† CDN. ØªØ­Ù‚Ù‚ Ù…Ù† Ø§ØªØµØ§Ù„ Ø§Ù„Ø¥Ù†ØªØ±Ù†Øª ÙˆØ³ÙŠØ§Ø³Ø© ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ø³ÙƒØ±ÙŠØ¨ØªØ§Øª.");
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
        const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        const pages = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          onProgress(`Ø§Ø³ØªØ®Ø±Ø§Ø¬ ØµÙØ­Ø© PDF ${pageNumber} Ù…Ù† ${pdf.numPages}`);
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          const rows = new Map();
          content.items.filter(item => typeof item.str === "string" && item.str.trim()).forEach(item => {
            const y = Math.round(item.transform?.[5] || 0);
            const row = rows.get(y) || [];
            row.push({ x: item.transform?.[4] || 0, text: item.str.trim() });
            rows.set(y, row);
          });
          let pageText = [...rows.entries()].sort((a, b) => b[0] - a[0])
            .map(([, row]) => row.sort((a, b) => a.x - b.x).map(item => item.text).join(" | ")).join("\n");
          if (pageText.replace(/\s/g, "").length < 20) {
            const viewport = page.getViewport({ scale: 1 });
            const scale = Math.min(1.8, Math.sqrt(1600000 / Math.max(1, viewport.width * viewport.height)));
            const scaled = page.getViewport({ scale });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(scaled.width);
            canvas.height = Math.ceil(scaled.height);
            const context = canvas.getContext("2d");
            if (!context) throw new Error("ØªØ¹Ø°Ø± Ø¥Ù†Ø´Ø§Ø¡ Ù…Ø³Ø§Ø­Ø© Ù…Ø¹Ø§Ù„Ø¬Ø© ØµÙØ­Ø© PDF Ø§Ù„Ù…ØµÙˆØ±Ø©.");
            await page.render({ canvasContext: context, viewport: scaled }).promise;
            onProgress(`OCR Ù„Ù„ØµÙØ­Ø© ${pageNumber} Ù…Ù† ${pdf.numPages}`);
            pageText = await recognizeProjectImage(canvas, onProgress);
            canvas.width = 0;
            canvas.height = 0;
          }
          pages.push(pageText);
          page.cleanup();
        }
        await pdf.destroy();
        return pages.join("\n\n");
      }
      async function extractProjectFileText(file, onProgress) {
        const extension = file.name.split(".").pop().toLocaleLowerCase();
        if (extension === "xlsx") return readExcelRows(file);
        if (extension === "docx") {
          if (!window.mammoth?.extractRawText) throw new Error("ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ù…ÙƒØªØ¨Ø© Word Ù…Ù† CDN. ØªØ­Ù‚Ù‚ Ù…Ù† Ø§ØªØµØ§Ù„ Ø§Ù„Ø¥Ù†ØªØ±Ù†Øª ÙˆØ³ÙŠØ§Ø³Ø© ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ø³ÙƒØ±ÙŠØ¨ØªØ§Øª.");
          const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
          return result.value;
        }
        if (extension === "pdf") return extractPdfProjectText(file, onProgress);
        if (file.type.startsWith("image/")) return recognizeProjectImage(file, onProgress);
        if (["csv", "txt", "tsv"].includes(extension)) return file.text();
        throw new Error("Ù†ÙˆØ¹ Ø§Ù„Ù…Ù„Ù ØºÙŠØ± Ù…Ø¯Ø¹ÙˆÙ… Ù„Ù„ØªØ­Ù„ÙŠÙ„. Ø§Ø®ØªØ± XLSX Ø£Ùˆ DOCX Ø£Ùˆ PDF Ø£Ùˆ ØµÙˆØ±Ø© Ø£Ùˆ CSV/TXT/TSV.");
      }
      function renderArchive() {
        if (!byId("archive-list")) return;
        const query = byId("archive-search").value.trim().toLocaleLowerCase();
        const items = appState.archive.filter(item => `${item.name} ${item.type} ${item.label || ""}`.toLocaleLowerCase().includes(query));
        byId("archive-list").innerHTML = items.map(item => `<article class="archive-item">
          <div class="archive-item-head"><div><div class="archive-name"><span class="archive-type">${escapeHTML(item.typeLabel || item.type)}</span> Â· ${escapeHTML(item.name)}</div><div class="archive-meta">${escapeHTML(item.label || "Ø¨Ø¯ÙˆÙ† ØªØµÙ†ÙŠÙ")} Â· ${escapeHTML(new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.savedAt)))}</div></div><span class="data-badge">${escapeHTML(item.sizeLabel || "")}</span></div>
          <div class="archive-actions"><button class="btn btn-secondary small-btn" type="button" data-archive-download="${escapeHTML(item.id)}">ØªÙ†Ø²ÙŠÙ„ Ø§Ù„Ù…Ù„Ù</button><button class="btn btn-danger small-btn" type="button" data-archive-delete="${escapeHTML(item.id)}">Ø­Ø°Ù</button></div>
        </article>`).join("");
        byId("archive-empty").hidden = items.length > 0;
        byId("archive-count").textContent = `${integer.format(appState.archive.length)} Ù…Ù„Ù`;
        const used = Object.keys(localStorage).reduce((sum, key) => sum + (localStorage.getItem(key) || "").length * 2, 0);
        const kb = used / 1024;
        byId("storage-usage").textContent = kb >= 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${Math.ceil(kb)} KB`;
        byId("storage-meter-fill").style.width = `${Math.min(100, used / (5 * 1024 * 1024) * 100)}%`;
        renderProjectKnowledge();
      }
      function renderProjectKnowledge() {
        const container = byId("project-knowledge-list");
        if (!container) return;
        const items = appState.projectKnowledge || [];
        container.innerHTML = items.map(item => {
          const points = item.points?.length
            ? item.points.map(point => `<li>${escapeHTML(point)}</li>`).join("")
            : "<li>Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ù†Ù‚Ø§Ø· Ø³Ø¹Ø± Ø£Ùˆ Ù…Ø³Ø§Ø­Ø© Ø£Ùˆ Ø³Ø¯Ø§Ø¯ Ø£Ùˆ Ù…ÙˆÙ‚Ø¹ ØªÙ„Ù‚Ø§Ø¦ÙŠÙ‹Ø§Ø› Ø±Ø§Ø¬Ø¹ Ø§Ù„Ù†Øµ Ø§Ù„Ù…Ø³ØªØ®Ø±Ø¬.</li>";
          const raw = item.extractedText
            ? `<details><summary class="knowledge-card-meta">Ø¹Ø±Ø¶ Ø§Ù„Ù†Øµ Ø§Ù„Ù…Ø³ØªØ®Ø±Ø¬${item.truncated ? " (Ù…Ù‚ØªØ·Ù)" : ""}</summary><div class="knowledge-raw">${escapeHTML(item.extractedText)}</div></details>`
            : "";
          return `<article class="knowledge-card">
            <h4>${escapeHTML(item.projectName || item.fileName)}</h4>
            <div class="knowledge-card-meta">${escapeHTML(item.fileName)} Â· ${escapeHTML(item.fileType)} Â· ${escapeHTML(item.statusLabel || "ØªÙ… Ø§Ù„Ø§Ø³ØªØ®Ø±Ø§Ø¬")}</div>
            <ul class="knowledge-points">${points}</ul>${raw}
            <div class="archive-actions"><button class="btn btn-secondary small-btn" type="button" data-knowledge-download="${escapeHTML(item.archiveId)}">ØªÙ†Ø²ÙŠÙ„ Ø§Ù„Ù…ØµØ¯Ø±</button></div>
          </article>`;
        }).join("");
        byId("project-knowledge-empty").hidden = items.length > 0;
      }
      byId("archive-list").addEventListener("click", event => {
        const downloadButton = event.target.closest("[data-archive-download]");
        const deleteButton = event.target.closest("[data-archive-delete]");
        if (downloadButton) {
          const item = appState.archive.find(file => file.id === downloadButton.dataset.archiveDownload);
          if (item) downloadArchiveEntry(item);
        }
        if (deleteButton) {
          const entry = appState.archive.find(file => file.id === deleteButton.dataset.archiveDelete);
          if (!entry || !window.confirm(`Ø­Ø°Ù "${entry.name}" Ù…Ù† Ø§Ù„Ø£Ø±Ø´ÙŠÙ Ø§Ù„Ù…Ø­Ù„ÙŠØŸ`)) return;
          const previousArchive = appState.archive;
          const previousKnowledge = appState.projectKnowledge;
          appState.archive = appState.archive.filter(file => file.id !== deleteButton.dataset.archiveDelete);
          appState.projectKnowledge = appState.projectKnowledge.filter(item => item.archiveId !== deleteButton.dataset.archiveDelete);
          if (!persistAppState()) {
            appState.archive = previousArchive;
            appState.projectKnowledge = previousKnowledge;
            return;
          }
          renderArchive();
          renderAnalytics();
          showToast("ØªÙ… Ø­Ø°Ù Ø§Ù„Ù…Ù„Ù Ù…Ù† Ø§Ù„Ø£Ø±Ø´ÙŠÙ Ø§Ù„Ù…Ø­Ù„ÙŠ.");
          return;
        }
        const knowledgeDownload = event.target.closest("[data-knowledge-download]");
        if (knowledgeDownload) {
          const entry = appState.archive.find(file => file.id === knowledgeDownload.dataset.knowledgeDownload);
          if (entry) downloadArchiveEntry(entry);
        }
      });
      byId("project-knowledge-list").addEventListener("click", event => {
        const button = event.target.closest("[data-knowledge-download]");
        if (!button) return;
        const entry = appState.archive.find(file => file.id === button.dataset.knowledgeDownload);
        if (entry) downloadArchiveEntry(entry);
      });
      byId("archive-search").addEventListener("input", renderArchive);
      byId("archive-upload").addEventListener("click", async () => {
        const files = Array.from(byId("archive-file").files || []);
        if (!files.length) { showToast("Ø§Ø®ØªØ± Ù…Ù„ÙÙ‹Ø§ ÙˆØ§Ø­Ø¯Ù‹Ø§ Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„."); return; }
        const maxBytes = 1.5 * 1024 * 1024;
        const oversized = files.find(file => file.size > maxBytes);
        if (oversized) { showToast(`Ø§Ù„Ù…Ù„Ù ${oversized.name} Ø£ÙƒØ¨Ø± Ù…Ù† 1.5 MB. Ù‚Ù„Ù‘Øµ Ø­Ø¬Ù…Ù‡ Ù‚Ø¨Ù„ Ø£Ø±Ø´ÙØªÙ‡ Ù…Ø­Ù„ÙŠÙ‹Ø§.`); return; }
        const label = byId("archive-label").value.trim();
        const archiveBeforeUpload = [...appState.archive];
        const knowledgeBeforeUpload = [...appState.projectKnowledge];
        const created = [];
        const failed = [];
        const uploadButton = byId("archive-upload");
        uploadButton.disabled = true;
        try {
          for (const [index, file] of files.entries()) {
            byId("knowledge-upload-progress").textContent = `ØªØ­Ù„ÙŠÙ„ ${file.name} Â· ${index + 1}/${files.length}`;
            try {
              const extractedText = (await extractProjectFileText(file, progress => {
                byId("knowledge-upload-progress").textContent = `${file.name} Â· ${progress}`;
              })).trim();
              if (!extractedText) throw new Error("Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ù†Øµ Ù‚Ø§Ø¨Ù„ Ù„Ù„Ø§Ø³ØªØ®Ø±Ø§Ø¬ ÙÙŠ Ø§Ù„Ù…Ù„Ù.");
              const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(reader.error || new Error("ØªØ¹Ø°Ø±Øª Ù‚Ø±Ø§Ø¡Ø© Ø§Ù„Ù…Ù„Ù."));
                reader.readAsDataURL(file);
              });
              const item = {
                id: makeId("file"), name: file.name, type: "project-document", typeLabel: "Ù…Ø³ØªÙ†Ø¯ Ù…Ø´Ø±ÙˆØ¹",
                mime: file.type || "application/octet-stream", dataUrl, label: label || "Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ù…Ø´Ø±ÙˆØ¹",
                sizeLabel: `${Math.max(1, Math.ceil(file.size / 1024))} KB`, savedAt: new Date().toISOString()
              };
              const knowledge = {
                archiveId: item.id, fileName: file.name, fileType: file.name.split(".").pop().toLocaleUpperCase(),
                projectName: label || file.name.replace(/\.[^.]+$/, ""), points: summarizeProjectText(extractedText),
                extractedText: extractedText.slice(0, 12000), truncated: extractedText.length > 12000,
                statusLabel: "Ø§Ø³ØªØ®Ù„Ø§Øµ Ù…Ø­Ù„ÙŠ Â· Ø±Ø§Ø¬Ø¹ Ø§Ù„Ù…ØµØ¯Ø± Ù‚Ø¨Ù„ Ù…Ø´Ø§Ø±ÙƒØ© Ø§Ù„Ù…ÙˆØ§ØµÙØ§Øª"
              };
              appState.archive.unshift(item);
              appState.projectKnowledge.unshift(knowledge);
              created.push(item.id);
            } catch (error) {
              console.error(`Could not analyze project file "${file.name}":`, error);
              failed.push(`${file.name}: ${error.message || "ØªØ¹Ø°Ø± Ø§Ù„Ø§Ø³ØªØ®Ø±Ø§Ø¬."}`);
            }
          }
          if (!created.length) {
            byId("knowledge-upload-progress").textContent = failed.join(" Â· ");
            showToast(failed[0] || "Ù„Ù… ÙŠØªÙ… ØªØ­Ù„ÙŠÙ„ Ø£ÙŠ Ù…Ø³ØªÙ†Ø¯.");
            return;
          }
          appState.archive = appState.archive.slice(0, 100);
          const retainedIds = new Set(appState.archive.map(item => item.id));
          appState.projectKnowledge = appState.projectKnowledge.filter(item => retainedIds.has(item.archiveId));
          if (!persistAppState(false)) throw new Error("ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø§Ù„Ù…Ø³ØªÙ†Ø¯Ø§Øª. Ù…Ø³Ø§Ø­Ø© Ø§Ù„ØªØ®Ø²ÙŠÙ† Ø§Ù„Ù…Ø­Ù„ÙŠØ© ØºÙŠØ± ÙƒØ§ÙÙŠØ©.");
          byId("archive-file").value = "";
          byId("archive-label").value = "";
          byId("knowledge-upload-progress").textContent = failed.length
            ? `ØªÙ… ØªØ­Ù„ÙŠÙ„ ${created.length} Ù…Ù„ÙØ› ØªØ¹Ø°Ø± ØªØ­Ù„ÙŠÙ„: ${failed.join(" Â· ")}`
            : `ØªÙ… ØªØ­Ù„ÙŠÙ„ ÙˆØ­ÙØ¸ ${created.length} Ù…Ù„Ù Ù…Ø­Ù„ÙŠÙ‹Ø§.`;
          renderArchive();
          renderAnalytics();
          showToast(failed.length
            ? `ØªÙ… ØªØ­Ù„ÙŠÙ„ ${created.length} Ù…Ù„ÙØ› ØªØ¹Ø°Ø± ØªØ­Ù„ÙŠÙ„ ${failed.length}. Ø±Ø§Ø¬Ø¹ ØªÙØ§ØµÙŠÙ„ ÙƒÙ„ Ù…Ù„Ù Ø£Ø¹Ù„Ø§Ù‡.`
            : `ØªÙ… ØªØ­Ù„ÙŠÙ„ ÙˆØ­ÙØ¸ ${integer.format(created.length)} Ù…Ù„Ù Ù…Ø´Ø±ÙˆØ¹Ø§Øª Ù…Ø­Ù„ÙŠÙ‹Ø§.`);
        } catch (error) {
          console.error("Could not archive selected files:", error);
          appState.archive = archiveBeforeUpload;
          appState.projectKnowledge = knowledgeBeforeUpload;
          persistAppState(false);
          renderArchive();
          byId("knowledge-upload-progress").textContent = error.message || "ÙØ´Ù„ Ø­ÙØ¸ Ù…Ù„ÙØ§Øª Ø§Ù„Ù…Ø´Ø±ÙˆØ¹Ø§Øª.";
          showToast(`ØªØ¹Ø°Ø± Ø­ÙØ¸ Ù…Ù„ÙØ§Øª Ø§Ù„Ù…Ø´Ø±ÙˆØ¹Ø§Øª: ${error.message || "ØªØ­Ù‚Ù‚ Ù…Ù† Ù…Ø³Ø§Ø­Ø© Ø§Ù„ØªØ®Ø²ÙŠÙ†."}`);
        } finally {
          uploadButton.disabled = false;
        }
      });

      byId("export-backup").addEventListener("click", () => {
        const backup = {
          format: "MJK-SALES-TOOLS-BACKUP",
          version: 2,
          exportedAt: new Date().toISOString(),
          leads,
          appState,
          settings: {
            calculator: (() => {
              try { return JSON.parse(localStorage.getItem(CALCULATOR_STORAGE_KEY) || "null"); }
              catch (error) {
                console.error("Could not read calculator settings for backup:", error);
                throw error;
              }
            })()
          }
        };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = `mjk-sales-backup-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1500);
        showToast("ØªÙ… ØªÙ†Ø²ÙŠÙ„ Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ø§Ø­ØªÙŠØ§Ø·ÙŠØ©.");
      });
      byId("import-backup").addEventListener("change", async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
          const parsed = JSON.parse(await file.text());
          if (parsed.format !== "MJK-SALES-TOOLS-BACKUP" || ![1, 2].includes(parsed.version) || !Array.isArray(parsed.leads) ||
              !parsed.appState || typeof parsed.appState !== "object" ||
              ["lookups", "appointments", "customScripts", "archive"].some(key => !Array.isArray(parsed.appState[key]))) {
            throw new Error("Backup format is not supported");
          }
          const calculatorValue = parsed.version === 1
            ? (parsed.calculator ? JSON.parse(parsed.calculator) : null)
            : (parsed.settings?.calculator ?? null);
          const restoredCalculator = calculatorValue;
          if (restoredCalculator !== null && (typeof restoredCalculator !== "object" || Array.isArray(restoredCalculator))) {
            throw new Error("Calculator settings are invalid");
          }
          if (restoredCalculator && ["price", "downPct", "years", "commissionPct", "closerPct", "frequency", "startDate"]
            .some(key => restoredCalculator[key] !== undefined && !["string", "number"].includes(typeof restoredCalculator[key]))) {
            throw new Error("Calculator settings contain invalid values");
          }
          if (!window.confirm("Ø³ØªÙØ³ØªØ¨Ø¯Ù„ Ø¨ÙŠØ§Ù†Ø§Øª MJK Ø§Ù„Ø­Ø§Ù„ÙŠØ© Ø¨Ù…Ø­ØªÙˆÙ‰ Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ø§Ø­ØªÙŠØ§Ø·ÙŠØ©. Ù‡Ù„ ØªØ±ÙŠØ¯ Ø§Ù„Ù…ØªØ§Ø¨Ø¹Ø©ØŸ")) return;
          const restoredLeads = parsed.leads.filter(item => item && typeof item.id === "string");
          const restoredState = {
            lookups: parsed.appState.lookups,
            appointments: parsed.appState.appointments,
            customScripts: parsed.appState.customScripts,
            archive: parsed.appState.archive,
            projectKnowledge: Array.isArray(parsed.appState.projectKnowledge) ? parsed.appState.projectKnowledge : [],
            crmBatches: Array.isArray(parsed.appState.crmBatches) ? parsed.appState.crmBatches : [],
            cleanerBatchRuns: Math.max(0, Number(parsed.appState.cleanerBatchRuns) || 0),
            cleanerRows: Array.isArray(parsed.appState.cleanerRows) ? parsed.appState.cleanerRows : [],
            rawContacts: typeof parsed.appState.rawContacts === "string" ? parsed.appState.rawContacts : "",
            cleanerPreferences: parsed.appState.cleanerPreferences || null,
            lastCleanerStats: parsed.appState.lastCleanerStats || { duplicates: 0, invalid: 0, batches: 0 }
          };
          const oldLeadData = localStorage.getItem(STORAGE_KEY);
          const oldAppState = localStorage.getItem(APP_STATE_KEY);
          const oldCalculator = localStorage.getItem(CALCULATOR_STORAGE_KEY);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(restoredLeads));
            localStorage.setItem(APP_STATE_KEY, JSON.stringify(restoredState));
            if (restoredCalculator) localStorage.setItem(CALCULATOR_STORAGE_KEY, JSON.stringify(restoredCalculator));
            else localStorage.removeItem(CALCULATOR_STORAGE_KEY);
          } catch (error) {
            if (oldLeadData === null) localStorage.removeItem(STORAGE_KEY);
            else localStorage.setItem(STORAGE_KEY, oldLeadData);
            if (oldAppState === null) localStorage.removeItem(APP_STATE_KEY);
            else localStorage.setItem(APP_STATE_KEY, oldAppState);
            if (oldCalculator === null) localStorage.removeItem(CALCULATOR_STORAGE_KEY);
            else localStorage.setItem(CALCULATOR_STORAGE_KEY, oldCalculator);
            throw error;
          }
          leads = restoredLeads;
          appState = restoredState;
          cleanedContacts = appState.cleanerRows;
          firedReminders.clear();
          for (let index = sessionStorage.length - 1; index >= 0; index--) {
            const key = sessionStorage.key(index);
            if (key && key.startsWith("mjk-reminder-")) sessionStorage.removeItem(key);
          }
          byId("raw-contacts").value = appState.rawContacts ||
            appState.cleanerRows.map(record => `${record.name || ""}, ${record.phone || ""}`).join("\n");
          if (appState.cleanerPreferences) {
            byId("batch-size").value = String(clamp(Number(appState.cleanerPreferences.batchSize) || 50, 1, 500));
            if ([...byId("phone-region").options].some(option => option.value === appState.cleanerPreferences.region)) {
              byId("phone-region").value = appState.cleanerPreferences.region;
            }
          }
          runCleaner(false, false);
          calculatorUserChanged = Boolean(restoredCalculator);
          byId("property-price").value = restoredCalculator?.price ?? "3000000";
          byId("down-payment-pct").value = restoredCalculator?.downPct ?? "10";
          byId("plan-years").value = restoredCalculator?.years ?? "8";
          byId("commission-pct").value = restoredCalculator?.commissionPct ?? "2.5";
          byId("closer-split-pct").value = restoredCalculator?.closerPct ?? "50";
          byId("installment-frequency").value = restoredCalculator?.frequency ?? "monthly";
          byId("installment-start").value = restoredCalculator?.startDate ?? localDateInput();
          updateCalculator();
          renderLeads();
          renderAppointments();
          renderLookup();
          renderArchive();
          renderScripts();
          renderSmartReply();
          renderAnalytics();
          checkAppointmentReminders();
          showToast("ØªÙ…Øª Ø§Ø³ØªØ¹Ø§Ø¯Ø© Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ø§Ø­ØªÙŠØ§Ø·ÙŠØ©.");
        } catch (error) {
          console.error("Could not restore MJK backup:", error);
          showToast("ØªØ¹Ø°Ø±Øª Ø§Ù„Ø§Ø³ØªØ¹Ø§Ø¯Ø©. ØªØ­Ù‚Ù‚ Ù…Ù† Ø³Ù„Ø§Ù…Ø© Ø§Ù„Ù…Ù„Ù ÙˆÙ…Ø³Ø§Ø­Ø© Ø§Ù„ØªØ®Ø²ÙŠÙ†ØŒ Ø«Ù… Ø§Ø®ØªØ± Ù†Ø³Ø®Ø© MJK JSON Ø³Ù„ÙŠÙ…Ø©.");
        } finally {
          event.target.value = "";
        }
      });

      function downloadCSV(filename, rows) {
        const csv = "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
        addArchiveEntry({
          name: filename, type: "csv", typeLabel: "CSV", mime: "text/csv;charset=utf-8",
          content: csv, sizeLabel: `${Math.max(1, Math.ceil(new Blob([csv]).size / 1024))} KB`,
          label: "ØªÙ… Ø§Ù„ØªØµØ¯ÙŠØ± Ù…Ù† MJK"
        });
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      byId("export-clients").addEventListener("click", () => {
        if (!leads.length) { showToast("Ù„Ø§ ØªÙˆØ¬Ø¯ Ø¨ÙŠØ§Ù†Ø§Øª Ø¹Ù…Ù„Ø§Ø¡ Ù„ØªØµØ¯ÙŠØ±Ù‡Ø§."); return; }
        const rows = [["Ø§Ù„Ù…Ø¹Ø±Ù", "Ø§Ù„Ø§Ø³Ù…", "Ø£Ø±Ù‚Ø§Ù… Ø§Ù„Ù‡Ø§ØªÙ", "Ø§Ù„Ø´Ø¨ÙƒØ©", "Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ", "Ø§Ù„Ù…Ø³Ù…Ù‰ Ø§Ù„ÙˆØ¸ÙŠÙÙŠ", "Ø¬Ù‡Ø© Ø§Ù„Ø¹Ù…Ù„", "Ø§Ù„Ù…ÙˆÙ‚Ø¹", "Ø§Ù„Ù…Ø´Ø±ÙˆØ¹", "Ø§Ù„Ø§Ù‡ØªÙ…Ø§Ù…", "ØªØ§Ø±ÙŠØ® Ø§Ù„Ù…ØªØ§Ø¨Ø¹Ø©", "Ù…Ù„Ø§Ø­Ø¸Ø§Øª", "Ø¯ÙØ¹Ø© CRM", "Ø§Ù„ØºØ±ÙØ©", "Ù…ÙƒØªÙ…Ù„", "VIP"], ...leads.map(lead => [
          lead.idNumber, lead.name, (lead.phones || [lead.phone]).filter(Boolean).join(" / "), lead.network, lead.email,
          lead.jobTitle, lead.company, lead.location, lead.project, interestLabels[lead.interest]?.label || lead.interest,
          lead.date, lead.notes, lead.sourceBatchId, lead.roomIndex, lead.completed ? "Ù†Ø¹Ù…" : "Ù„Ø§", lead.vip ? "Ù†Ø¹Ù…" : "Ù„Ø§"
        ])];
        downloadCSV("mjk-clients.csv", rows);
        showToast("ØªÙ… ØªØ¬Ù‡ÙŠØ² Ù…Ù„Ù Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡ CSV.");
      });

      const calculatorDefaults = { price: "3000000", downPct: "10", years: "8", commissionPct: "2.5", closerPct: "50", frequency: "monthly" };
      try {
        const savedCalculator = JSON.parse(localStorage.getItem("mjkCalculator.v1") || "null");
        if (savedCalculator && typeof savedCalculator === "object") {
          byId("property-price").value = savedCalculator.price ?? calculatorDefaults.price;
          byId("down-payment-pct").value = savedCalculator.downPct ?? calculatorDefaults.downPct;
          byId("plan-years").value = savedCalculator.years ?? calculatorDefaults.years;
          byId("commission-pct").value = savedCalculator.commissionPct ?? calculatorDefaults.commissionPct;
          byId("closer-split-pct").value = savedCalculator.closerPct ?? calculatorDefaults.closerPct;
          byId("installment-frequency").value = savedCalculator.frequency ?? calculatorDefaults.frequency;
        }
      } catch (error) { console.error("Could not load calculator preferences:", error); }
      const calcInputs = ["property-price", "down-payment-pct", "plan-years", "commission-pct", "closer-split-pct", "installment-frequency", "installment-start"];
      const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
      const formatMoney = amount => `${money.format(Number.isFinite(amount) ? amount : 0)} Ø¬.Ù…`;
      function roundCurrency(amount) { return Math.round((amount + Number.EPSILON) * 100) / 100; }
      function localDateInput(date = new Date()) {
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 10);
      }
      byId("installment-start").value = localDateInput();
      try {
        const savedCalculator = JSON.parse(localStorage.getItem("mjkCalculator.v1") || "null");
        if (savedCalculator?.startDate) byId("installment-start").value = savedCalculator.startDate;
      } catch (error) { console.error("Could not load saved installment start date:", error); }
      function getScheduleDueDate(startValue, period, monthsPerPeriod) {
        const [year, month, day] = startValue.split("-").map(Number);
        const date = new Date(Date.UTC(year, month - 1 + period * monthsPerPeriod, 1));
        const finalDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
        date.setUTCDate(Math.min(day, finalDay));
        return date;
      }
      function updateInstallmentSchedule(remaining, years) {
        const frequency = byId("installment-frequency").value;
        const cadence = { monthly: { months: 1, label: "Ø´Ù‡Ø±ÙŠ" }, quarterly: { months: 3, label: "Ø±Ø¨Ø¹ Ø³Ù†ÙˆÙŠ" }, yearly: { months: 12, label: "Ø³Ù†ÙˆÙŠ" } }[frequency] || { months: 1, label: "Ø´Ù‡Ø±ÙŠ" };
        const totalPeriods = Math.floor(years) * 12 / cadence.months;
        const regularAmount = totalPeriods ? roundCurrency(remaining / totalPeriods) : 0;
        const firstDate = byId("installment-start").value || localDateInput();
        let balance = roundCurrency(remaining);
        calculatorSchedule = [];
        for (let period = 0; period < totalPeriods; period++) {
          const amount = period === totalPeriods - 1 ? roundCurrency(balance) : Math.min(balance, regularAmount);
          balance = Math.max(0, roundCurrency(balance - amount));
          calculatorSchedule.push({
            index: period + 1,
            date: getScheduleDueDate(firstDate, period, cadence.months),
            amount,
            balance
          });
        }
        const visible = calculatorSchedule.slice(0, 60);
        byId("schedule-rows").innerHTML = visible.map(row => `<tr><td>${integer.format(row.index)}</td><td>${escapeHTML(new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(row.date))}</td><td>${formatMoney(row.amount)}</td><td>${formatMoney(row.balance)}</td></tr>`).join("");
        const scheduleTable = byId("schedule-rows").closest(".schedule-table");
        scheduleTable.scrollLeft = scheduleTable.scrollWidth;
        byId("schedule-summary").textContent = `${integer.format(totalPeriods)} Ù‚Ø³Ø· ${cadence.label} Â· Ø§Ù„Ù…Ø¹Ø±ÙˆØ¶ ${integer.format(visible.length)}${totalPeriods > visible.length ? ` Ù…Ù† ${integer.format(totalPeriods)}Ø› ØµØ¯Ù‘Ø± CSV Ù„Ø¹Ø±Ø¶ Ø§Ù„Ø¬Ø¯ÙˆÙ„ ÙƒØ§Ù…Ù„Ù‹Ø§` : ""}.`;
      }
      function updateCalculator() {
        const price = Math.max(0, Number(byId("property-price").value) || 0);
        const downPct = clamp(Number(byId("down-payment-pct").value) || 0, 0, 100);
        const years = clamp(Math.floor(Number(byId("plan-years").value) || 1), 1, 50);
        const remaining = price * (1 - downPct / 100);
        byId("down-payment-result").textContent = formatMoney(price * downPct / 100);
        byId("monthly-result").textContent = formatMoney(remaining / (years * 12));
        byId("quarterly-result").textContent = formatMoney(remaining / (years * 4));
        byId("remaining-result").textContent = formatMoney(remaining);
        updateInstallmentSchedule(remaining, years);

        const commissionPct = clamp(Number(byId("commission-pct").value) || 0, 0, 100);
        const closerPct = clamp(Number(byId("closer-split-pct").value) || 0, 0, 100);
        const commission = price * commissionPct / 100;
        const closerAmount = commission * closerPct / 100;
        byId("commission-total-result").textContent = formatMoney(commission);
        byId("closer-amount").textContent = formatMoney(closerAmount);
        byId("owner-amount").textContent = formatMoney(commission - closerAmount);
        byId("closer-percent-label").textContent = `${integer.format(closerPct)}Ùª`;
        byId("owner-percent-label").textContent = `${integer.format(100 - closerPct)}Ùª`;
        byId("split-bar-closer").style.width = `${closerPct}%`;
        if (calculatorUserChanged) {
          try {
            localStorage.setItem(CALCULATOR_STORAGE_KEY, JSON.stringify({
              price: byId("property-price").value, downPct: byId("down-payment-pct").value,
              years: byId("plan-years").value, commissionPct: byId("commission-pct").value,
              closerPct: byId("closer-split-pct").value, frequency: byId("installment-frequency").value,
              startDate: byId("installment-start").value
            }));
          } catch (error) { console.error("Could not save calculator preferences:", error); }
        }
      }
      calcInputs.forEach(id => {
        const input = byId(id);
        const markChanged = () => { calculatorUserChanged = true; updateCalculator(); };
        input.addEventListener("input", markChanged);
        input.addEventListener("change", markChanged);
      });
      byId("export-schedule").addEventListener("click", () => {
        if (!calculatorSchedule.length) { showToast("Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ø¬Ø¯ÙˆÙ„ Ù„ØªØµØ¯ÙŠØ±Ù‡."); return; }
        downloadCSV("mjk-installment-schedule.csv", [["Ø±Ù‚Ù… Ø§Ù„Ù‚Ø³Ø·", "ØªØ§Ø±ÙŠØ® Ø§Ù„Ø§Ø³ØªØ­Ù‚Ø§Ù‚", "Ù‚ÙŠÙ…Ø© Ø§Ù„Ù‚Ø³Ø·", "Ø§Ù„Ø±ØµÙŠØ¯ Ø¨Ø¹Ø¯ Ø§Ù„Ø³Ø¯Ø§Ø¯"], ...calculatorSchedule.map(row => [
          row.index, row.date.toISOString().slice(0, 10), row.amount.toFixed(2), row.balance.toFixed(2)
        ])]);
        showToast("ØªÙ… ØªØµØ¯ÙŠØ± Ø¬Ø¯ÙˆÙ„ Ø§Ù„Ø£Ù‚Ø³Ø§Ø· ÙˆØ£Ø±Ø´ÙØªÙ‡.");
      });
      updateCalculator();

      const receiptMap = {
        "receipt-client": "preview-client", "receipt-phone": "preview-phone",
        "receipt-project": "preview-project", "receipt-unit-type": "preview-unit-type",
        "receipt-unit-number": "preview-unit-number", "receipt-notes": "preview-notes"
      };
      function updateReceipt() {
        Object.entries(receiptMap).forEach(([inputId, previewId]) => {
          const value = byId(inputId).value.trim();
          byId(previewId).textContent = value || (inputId === "receipt-notes" ? "Ù„Ø§ ØªÙˆØ¬Ø¯ Ù…Ù„Ø§Ø­Ø¸Ø§Øª." : "â€”");
        });
        const dateValue = byId("receipt-date").value;
        byId("preview-date").textContent = dateValue
          ? new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${dateValue}T12:00:00`))
          : "â€”";
        const deposit = Number(byId("receipt-deposit").value);
        byId("preview-deposit").textContent = deposit > 0 ? formatMoney(deposit) : "â€”";
      }
      document.querySelectorAll(".receipt-input").forEach(input => input.addEventListener("input", updateReceipt));
      byId("receipt-number").textContent = `MJK-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
      byId("print-receipt").addEventListener("click", () => {
        updateReceipt();
        const fields = [
          ["Ø§Ø³Ù… Ø§Ù„Ø¹Ù…ÙŠÙ„", byId("preview-client").textContent], ["Ø±Ù‚Ù… Ø§Ù„Ù‡Ø§ØªÙ", byId("preview-phone").textContent],
          ["Ø§Ù„Ù…Ø´Ø±ÙˆØ¹ / Ø§Ù„Ø¹Ù‚Ø§Ø±", byId("preview-project").textContent], ["Ù†ÙˆØ¹ Ø§Ù„ÙˆØ­Ø¯Ø©", byId("preview-unit-type").textContent],
          ["Ø±Ù‚Ù… Ø§Ù„ÙˆØ­Ø¯Ø©", byId("preview-unit-number").textContent], ["ØªØ§Ø±ÙŠØ® Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø© / Ø§Ù„Ø­Ø¬Ø²", byId("preview-date").textContent],
          ["Ù…Ø¨Ù„Øº Ø§Ù„Ø¹Ø±Ø¨ÙˆÙ† / Ø¬Ø¯ÙŠØ© Ø§Ù„Ø­Ø¬Ø²", byId("preview-deposit").textContent]
        ];
        const receiptHTML = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>MJK Receipt</title><style>body{font:15px Arial,sans-serif;color:#222;max-width:800px;margin:40px auto;padding:32px;border:1px solid #ddd}h1{color:#d98200}.tag{border-bottom:2px solid #e8a01a;padding:12px 0}.row{padding:12px 0;border-bottom:1px solid #eee}.label{color:#667}.sign{display:flex;gap:80px;margin-top:60px}</style><body><div class="tag"><h1>MJK REAL ESTATE</h1>Ø§Ø³ØªÙ…Ø§Ø±Ø© Ù…Ø¹Ø§ÙŠÙ†Ø© / Ø­Ø¬Ø² Â· ${escapeHTML(byId("receipt-number").textContent)}</div><h2>Ø¥ÙŠØµØ§Ù„ Ù…Ø¹Ø§ÙŠÙ†Ø© ÙˆØ­Ø¬Ø² ÙˆØ­Ø¯Ø©</h2>${fields.map(([label, value]) => `<div class="row"><span class="label">${escapeHTML(label)}</span><br><strong>${escapeHTML(value)}</strong></div>`).join("")}<div class="row"><span class="label">Ù…Ù„Ø§Ø­Ø¸Ø§Øª</span><br>${escapeHTML(byId("preview-notes").textContent)}</div><div class="sign"><span>ØªÙˆÙ‚ÙŠØ¹ Ø§Ù„Ø¹Ù…ÙŠÙ„</span><span>Ù…Ù†Ø¯ÙˆØ¨ MJK</span></div></body></html>`;
        addArchiveEntry({
          name: `${byId("receipt-number").textContent}.html`, type: "receipt", typeLabel: "Ø¥ÙŠØµØ§Ù„ Ù„Ù„Ø·Ø¨Ø§Ø¹Ø©",
          mime: "text/html;charset=utf-8", content: receiptHTML, sizeLabel: "Ù†Ø³Ø®Ø© Ù‚Ø§Ø¨Ù„Ø© Ù„Ù„Ø·Ø¨Ø§Ø¹Ø©",
          label: byId("preview-client").textContent === "â€”" ? "Ø§Ø³ØªÙ…Ø§Ø±Ø© Ø­Ø¬Ø²" : `Ø¹Ù…ÙŠÙ„: ${byId("preview-client").textContent}`
        });
        showToast("Ø­ÙÙØ¸Øª Ù†Ø³Ø®Ø© Ø§Ù„Ø§Ø³ØªÙ…Ø§Ø±Ø© Ø§Ù„Ù‚Ø§Ø¨Ù„Ø© Ù„Ù„Ø·Ø¨Ø§Ø¹Ø© ÙÙŠ Ø§Ù„Ø£Ø±Ø´ÙŠÙ.");
        window.print();
      });
      byId("reset-receipt").addEventListener("click", () => {
        byId("receipt-form").reset();
        updateReceipt();
        showToast("ØªÙ… ØªÙØ±ÙŠØº Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø§Ø³ØªÙ…Ø§Ø±Ø©.");
      });
      updateReceipt();

      const cleanerColumns = [
        { key: "id", label: "ID / Ø§Ù„Ù…Ø¹Ø±Ù" }, { key: "name", label: "Ø§Ù„Ø§Ø³Ù… Ø§Ù„ÙƒØ§Ù…Ù„" },
        { key: "phones", label: "Ø£Ø±Ù‚Ø§Ù… Ø§Ù„Ù‡Ø§ØªÙ" }, { key: "network", label: "Ø´Ø¨ÙƒØ© Ø§Ù„Ù…Ø­Ù…ÙˆÙ„" },
        { key: "email", label: "Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ" }, { key: "jobTitle", label: "Ø§Ù„Ù…Ø³Ù…Ù‰ Ø§Ù„ÙˆØ¸ÙŠÙÙŠ" },
        { key: "company", label: "Ø¬Ù‡Ø© Ø§Ù„Ø¹Ù…Ù„" }, { key: "location", label: "Ø§Ù„Ù…ÙˆÙ‚Ø¹" }
      ];
      const cleanerHeaders = {
        id: /^(id|identifier|record id|Ø§Ù„Ù…Ø¹Ø±Ù|Ù…Ø¹Ø±Ù|Ø±Ù‚Ù… ØªØ¹Ø±ÙŠÙÙŠ|ÙƒÙˆØ¯ Ø§Ù„Ø¹Ù…ÙŠÙ„)(\s*\/.*)?$/i,
        name: /^(name|full name|fullname|customer name|client name|Ø§Ù„Ø§Ø³Ù…|Ø§Ù„Ø§Ø³Ù… Ø§Ù„ÙƒØ§Ù…Ù„|Ø§Ø³Ù… Ø§Ù„Ø¹Ù…ÙŠÙ„)$/i,
        phones: /^(phone|phones|phone number|mobile|mobile number|telephone|tel|Ø£Ø±Ù‚Ø§Ù… Ø§Ù„Ù‡Ø§ØªÙ|Ø±Ù‚Ù… Ø§Ù„Ù‡Ø§ØªÙ|Ø§Ù„Ù‡Ø§ØªÙ|Ø§Ù„Ù…ÙˆØ¨Ø§ÙŠÙ„|Ø±Ù‚Ù… Ø§Ù„Ù…ÙˆØ¨Ø§ÙŠÙ„)$/i,
        network: /^(network|carrier|operator|telecom network|Ø§Ù„Ø´Ø¨ÙƒØ©|Ø´Ø¨ÙƒØ© Ø§Ù„Ù…Ø­Ù…ÙˆÙ„|Ø´Ø±ÙƒØ© Ø§Ù„Ø§ØªØµØ§Ù„Ø§Øª)$/i,
        email: /^(email|e-mail|Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ|Ø§Ù„Ø¨Ø±ÙŠØ¯|Ø§Ù„Ø§ÙŠÙ…ÙŠÙ„|Ø§Ù„Ø¥ÙŠÙ…ÙŠÙ„)$/i,
        jobTitle: /^(occupation|job|job title|title|position|Ø§Ù„Ù…Ù‡Ù†Ø©|Ø§Ù„ÙˆØ¸ÙŠÙØ©|Ø§Ù„Ù…Ø³Ù…Ù‰ Ø§Ù„ÙˆØ¸ÙŠÙÙŠ)$/i,
        company: /^(company|workplace|employer|Ø¬Ù‡Ø© Ø§Ù„Ø¹Ù…Ù„|Ø§Ù„Ø´Ø±ÙƒØ©|Ù…ÙƒØ§Ù† Ø§Ù„Ø¹Ù…Ù„)$/i,
        location: /^(location|city|governorate|region|Ø§Ù„Ù…ÙˆÙ‚Ø¹|Ø§Ù„Ù…Ø¯ÙŠÙ†Ø©|Ø§Ù„Ù…Ø­Ø§ÙØ¸Ø©|Ù…Ø­Ø§ÙØ¸Ø©)$/i
      };
      const knownLocations = [
        "New Valley", "South Sinai", "North Sinai", "Red Sea", "Kafr El Sheikh", "Port Said",
        "Beni Suef", "Wadi El Natrun", "Alexandria", "Ismailia", "Damietta", "Monufia",
        "Dakahlia", "Beheira", "Gharbia", "Qalyubia", "Fayoum", "Matrouh", "Aswan",
        "Luxor", "Sohag", "Qena", "Assiut", "Minya", "Cairo", "Giza", "Sharkia",
        "Ø§Ù„Ù‚Ø§Ù‡Ø±Ø©", "Ø§Ù„Ø¬ÙŠØ²Ø©", "Ø§Ù„Ø¥Ø³ÙƒÙ†Ø¯Ø±ÙŠØ©", "Ø§Ø³ÙƒÙ†Ø¯Ø±ÙŠØ©", "Ø³ÙˆÙ‡Ø§Ø¬", "Ø£Ø³ÙŠÙˆØ·", "Ø§Ù„Ù…Ù†ÙŠØ§",
        "Ù‚Ù†Ø§", "Ø§Ù„Ø£Ù‚ØµØ±", "Ø§Ø³ÙˆØ§Ù†", "Ø£Ø³ÙˆØ§Ù†", "Ø§Ù„Ø¨Ø­ÙŠØ±Ø©", "Ù…Ø·Ø±ÙˆØ­", "Ø¯Ù…ÙŠØ§Ø·", "Ø¨ÙˆØ±Ø³Ø¹ÙŠØ¯",
        "Ø§Ù„Ø¥Ø³Ù…Ø§Ø¹ÙŠÙ„ÙŠØ©", "Ø§Ù„Ø´Ø±Ù‚ÙŠØ©", "Ø§Ù„ØºØ±Ø¨ÙŠØ©", "Ø§Ù„Ø¯Ù‚Ù‡Ù„ÙŠØ©", "Ø§Ù„Ù…Ù†ÙˆÙÙŠØ©", "Ø§Ù„Ù‚Ù„ÙŠÙˆØ¨ÙŠØ©",
        "Ø¨Ù†ÙŠ Ø³ÙˆÙŠÙ", "ÙƒÙØ± Ø§Ù„Ø´ÙŠØ®", "Ø´Ù…Ø§Ù„ Ø³ÙŠÙ†Ø§Ø¡", "Ø¬Ù†ÙˆØ¨ Ø³ÙŠÙ†Ø§Ø¡", "Ø§Ù„Ø¨Ø­Ø± Ø§Ù„Ø£Ø­Ù…Ø±",
        "Ø§Ù„ÙˆØ§Ø¯Ù‰ Ø§Ù„Ø¬Ø¯ÙŠØ¯", "Ø§Ù„ÙˆØ§Ø¯ÙŠ Ø§Ù„Ø¬Ø¯ÙŠØ¯"
      ];
      const networkNames = [
        { label: "Vodafone", pattern: /vodafone|ÙÙˆØ¯Ø§ÙÙˆÙ†/i },
        { label: "Orange", pattern: /orange|Ø§ÙˆØ±Ù†Ø¬|Ø£ÙˆØ±Ù†Ø¬/i },
        { label: "Etisalat", pattern: /etisalat|Ø§ØªØµØ§Ù„Ø§Øª/i },
        { label: "WE", pattern: /(?:^|\W)we(?:$|\W)|ÙˆÙŠ\b/i }
      ];
      function normalizeCleanerDigits(value) {
        return String(value ?? "").replace(/[Ù -Ù©Û°-Û¹]/g, digit => {
          const code = digit.charCodeAt(0);
          return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
        });
      }
      function splitDelimitedRow(line, delimiter = ",") {
        const cells = [];
        let value = "";
        let quoted = false;
        for (let index = 0; index < line.length; index++) {
          const character = line[index];
          if (character === '"') {
            if (quoted && line[index + 1] === '"') { value += '"'; index++; }
            else quoted = !quoted;
          } else if (character === delimiter && !quoted) {
            cells.push(value.trim());
            value = "";
          } else value += character;
        }
        cells.push(value.trim());
        if (cells.length) cells[0] = cells[0].replace(/^\uFEFF/, "");
        return cells;
      }
      function parseCleanerCells(line) {
        const commaCount = (line.match(/,/g) || []).length;
        const tabCount = (line.match(/\t/g) || []).length;
        let cells = splitDelimitedRow(line, tabCount > commaCount ? "\t" : ",");
        if (cells.length === 1 && cells[0].includes(",")) cells = splitDelimitedRow(cells[0]);
        return cells;
      }
      function detectCleanerHeader(cells) {
        const mapping = {};
        cells.forEach((cell, index) => {
          const header = cell.trim().replace(/^[\uFEFF\s]+|[\s:ï¼š]+$/g, "").toLocaleLowerCase();
          for (const [key, pattern] of Object.entries(cleanerHeaders)) {
            if (pattern.test(header)) {
              (mapping[key] ||= []).push(index);
              break;
            }
          }
        });
        const distinctFields = Object.keys(mapping).length;
        return distinctFields >= 2 && (mapping.name || mapping.phones) ? mapping : null;
      }
      function mappedValues(cells, mapping, key) {
        return (mapping?.[key] || []).map(index => cells[index] || "").filter(Boolean);
      }
      function isEmploymentText(value) {
        return /Ù…Ø­Ø§Ø³Ø¨|Ù…Ù‡Ù†Ø¯Ø³|Ø·Ø¨ÙŠØ¨|Ù…Ø¯ÙŠØ±|Ù…ÙˆØ¸Ù|Ù…Ø¯Ø±Ø³|Ù…Ø­Ø§Ù…|Ù…Ø¨ÙŠØ¹Ø§Øª|Ù…Ø­Ù„Ù„|ÙÙ†ÙŠ|Ø³ÙƒØ±ØªÙŠØ±|accountant|engineer|doctor|manager|employee|teacher|lawyer|sales|analyst|technician|company|Ø´Ø±ÙƒØ©|Ø¨Ø´Ø±ÙƒØ©|Ù„Ù„Ø¹Ù…Ù„/i.test(value);
      }
      function parseCleanerRecord(cells, mapping, positional) {
        const selectedRegion = byId("phone-region").value;
        const remaining = cells.map(value => normalizeCleanerDigits(value).trim());
        const used = new Set();
        const values = key => mappedValues(cells, mapping, key).map(normalizeCleanerDigits);
        let id = values("id").join(" ").trim();
        let name = values("name").join(" ").trim();
        let network = values("network").join(" ").trim();
        let email = values("email").join(" ").trim();
        let jobTitle = values("jobTitle").join(" ").trim();
        let company = values("company").join(" ").trim();
        let location = values("location").join(" ").trim();
        if (mapping) Object.values(mapping).flat().forEach(index => used.add(index));
        if (positional) {
          const positionKeys = ["id", "name", "phones", "network", "email", "jobTitle", "company", "location"];
          positionKeys.forEach((key, index) => {
            if (cells[index]) used.add(index);
            if (mapping) return;
            const value = normalizeCleanerDigits(cells[index] || "").trim();
            if (key === "id" && !id) id = value;
            if (key === "name" && !name) name = value;
            if (key === "network" && !network) network = value;
            if (key === "email" && !email) email = value;
            if (key === "jobTitle" && !jobTitle) jobTitle = value;
            if (key === "company" && !company) company = value;
            if (key === "location" && !location) location = value;
          });
        }
        const phones = [];
        const phonePattern = /(?:\+|00)?[0-9][0-9\s().\-]{6,}[0-9]/g;
        remaining.forEach((cell, index) => {
          for (const match of cell.matchAll(phonePattern)) {
            const normalized = normalizePhone(match[0], selectedRegion);
            if (normalized && !phones.includes(normalized)) phones.push(normalized);
          }
          const candidates = [...cell.matchAll(phonePattern)].map(match => match[0])
            .filter(candidate => normalizePhone(candidate, selectedRegion));
          if (candidates.length) {
            let cleaned = cell;
            candidates.forEach(candidate => { cleaned = cleaned.replace(candidate, " "); });
            remaining[index] = cleaned.replace(/[|;ØŒ/]+/g, " ").replace(/\s+/g, " ").trim();
          }
        });
        if (!id) {
          const idIndex = remaining.findIndex((cell, index) => !used.has(index) && /^\s*(?:id\s*[:#-]?\s*)?\d{6,}(?:\.0+)?\s*$/i.test(cell));
          if (idIndex >= 0) { id = remaining[idIndex].replace(/^id\s*[:#-]?\s*/i, "").replace(/\.0+$/, ""); used.add(idIndex); }
        } else id = id.replace(/\.0+$/, "");
        if (!network) {
          const match = remaining.find((cell, index) => !used.has(index) && networkNames.some(item => item.pattern.test(cell)));
          if (match) network = networkNames.find(item => item.pattern.test(match)).label;
        } else {
          const match = networkNames.find(item => item.pattern.test(network));
          if (match) network = match.label;
        }
        if (!email) email = remaining.map(cell => cell.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]).find(Boolean) || "";
        if (!location) location = knownLocations.find(city => remaining.some(cell => cell.toLocaleLowerCase().includes(city.toLocaleLowerCase()))) || "";
        const leftovers = remaining.filter((cell, index) => !used.has(index) && cell)
          .map(cell => cell.replace(/[|;ØŒ]+/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
        if (!name) {
          name = leftovers.find(cell => !isEmploymentText(cell) && !/@/.test(cell) &&
            !networkNames.some(item => item.pattern.test(cell)) &&
            !knownLocations.some(city => cell.toLocaleLowerCase().includes(city.toLocaleLowerCase()))) || "";
        }
        const employment = leftovers.filter(cell => cell !== name && isEmploymentText(cell));
        if (!jobTitle && employment.length) {
          const workText = employment[0];
          const companyStart = workText.match(/(?:Ø¨|ÙÙŠ)\s*(Ø´Ø±ÙƒØ©|company)\s*/i);
          if (companyStart) {
            const splitAt = companyStart.index;
            jobTitle = workText.slice(0, splitAt).trim();
            company = company || workText.slice(splitAt).replace(/^(?:Ø¨|ÙÙŠ)\s*/i, "").trim();
          } else jobTitle = workText;
        }
        if (!company && employment.length > 1) company = employment[1];
        if (!company && positional && cells[6]) company = normalizeCleanerDigits(cells[6]).trim();
        if (!location && positional && cells[7]) location = normalizeCleanerDigits(cells[7]).trim();
        const embeddedCompany = jobTitle.match(/(?:Ø¨|ÙÙŠ)\s*(Ø´Ø±ÙƒØ©|company)\s*/i);
        if (embeddedCompany) {
          const splitAt = embeddedCompany.index;
          company = company || jobTitle.slice(splitAt).replace(/^(?:Ø¨|ÙÙŠ)\s*/i, "").trim();
          jobTitle = jobTitle.slice(0, splitAt).trim();
        }
        if (!network) {
          const match = remaining.map(cell => networkNames.find(item => item.pattern.test(cell))).find(Boolean);
          if (match) network = match.label;
        }
        return {
          id, name, phone: phones[0] || "", phones, network, email, jobTitle, company, location,
          invalid: phones.length === 0
        };
      }
      function isCleanerHeader(cells) {
        return Boolean(detectCleanerHeader(cells));
      }
      function runCleaner(countAsProcessed = true, showNotification = true) {
        const raw = byId("raw-contacts").value;
        const lines = raw.split(/\r?\n/);
        const nonEmptyLines = lines.filter(line => line.trim());
        const firstLineCells = nonEmptyLines.length ? parseCleanerCells(nonEmptyLines[0]) : [];
        const headerMapping = detectCleanerHeader(firstLineCells);
        const positional = !headerMapping && firstLineCells.length >= 4 &&
          /^\s*\d{6,}(?:\.0+)?\s*$/.test(normalizeCleanerDigits(firstLineCells[0] || ""));
        const unique = new Map();
        const uniqueRecords = [];
        let duplicates = 0;
        let invalid = 0;
        lines.forEach((line, lineIndex) => {
          if (!line.trim()) return;
          const cells = parseCleanerCells(line);
          if (lineIndex === lines.findIndex(item => item.trim()) && isCleanerHeader(cells)) return;
          const record = parseCleanerRecord(cells, headerMapping, positional);
          if (!record || record.invalid) { invalid++; return; }
          const duplicateRecord = record.phones.map(phone => unique.get(phone)).find(Boolean);
          if (duplicateRecord) {
            duplicates++;
            const existing = duplicateRecord;
            ["id", "name", "network", "email", "jobTitle", "company", "location"].forEach(key => {
              if (!existing[key] && record[key]) existing[key] = record[key];
            });
            record.phones.forEach(phone => { if (!existing.phones.includes(phone)) existing.phones.push(phone); });
            existing.phones.forEach(phone => unique.set(phone, existing));
          } else {
            uniqueRecords.push(record);
            record.phones.forEach(phone => unique.set(phone, record));
          }
        });
        cleanedContacts = uniqueRecords;
        const batchSize = clamp(Math.floor(Number(byId("batch-size").value) || 50), 1, 500);
        byId("batch-size").value = String(batchSize);
        const batches = [];
        for (let index = 0; index < cleanedContacts.length; index += batchSize) {
          batches.push(cleanedContacts.slice(index, index + batchSize));
        }
        appState.cleanerRows = cleanedContacts;
        appState.rawContacts = raw;
        appState.cleanerPreferences = { batchSize, region: byId("phone-region").value };
        appState.lastCleanerStats = { duplicates, invalid, batches: batches.length };
        if (countAsProcessed) appState.cleanerBatchRuns += batches.length;
        persistAppState();
        byId("clean-count").textContent = integer.format(cleanedContacts.length);
        byId("duplicate-count").textContent = integer.format(duplicates);
        byId("invalid-count").textContent = integer.format(invalid);
        byId("batch-count").textContent = integer.format(batches.length);
        byId("download-csv").disabled = cleanedContacts.length === 0;
        byId("download-xlsx").disabled = cleanedContacts.length === 0;
        byId("copy-cleaned").disabled = cleanedContacts.length === 0;
        byId("cleaner-preview-body").innerHTML = cleanedContacts.map(record => `<tr>
          <td dir="ltr">${escapeHTML(record.id || "â€”")}</td><td>${escapeHTML(record.name || "â€”")}</td>
          <td dir="ltr">${escapeHTML((record.phones || [record.phone]).join(", "))}</td><td>${escapeHTML(record.network || "â€”")}</td>
          <td dir="ltr">${escapeHTML(record.email || "â€”")}</td><td>${escapeHTML(record.jobTitle || "â€”")}</td>
          <td>${escapeHTML(record.company || "â€”")}</td><td>${escapeHTML(record.location || "â€”")}</td></tr>`).join("");
        byId("cleaner-preview-empty").hidden = cleanedContacts.length > 0;
        const list = byId("batch-list");
        if (!batches.length) {
          list.innerHTML = '<div class="table-empty"><strong>Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ø£Ø±Ù‚Ø§Ù… ØµØ§Ù„Ø­Ø©</strong><span>Ø±Ø§Ø¬Ø¹ Ø§Ù„Ø¯ÙˆÙ„Ø© Ø§Ù„Ù…Ø­Ø¯Ø¯Ø© Ø£Ùˆ Ø£Ø¶Ù Ø±Ù‚Ù… Ù…ÙˆØ¨Ø§ÙŠÙ„ Ù…ØµØ±ÙŠÙ‹Ø§ Ø£Ùˆ Ø®Ù„ÙŠØ¬ÙŠÙ‹Ø§ ØµØ­ÙŠØ­Ù‹Ø§.</span></div>';
        } else {
          list.innerHTML = batches.map((batch, index) => `<div class="batch-card"><div class="batch-heading"><span>Ø§Ù„Ø¯ÙØ¹Ø© ${integer.format(index + 1)}</span><span>${integer.format(batch.length)} Ø¬Ù‡Ø© Ø§ØªØµØ§Ù„</span></div><div class="batch-contacts">${batch.map(record => `${escapeHTML(record.phone)}${record.name ? `  Â·  ${escapeHTML(record.name)}` : ""}`).join("\n")}</div></div>`).join("");
        }
        renderCrmSendBatches();
        if (showNotification) showToast(`Ø§ÙƒØªÙ…Ù„Øª Ø§Ù„ØªÙ†Ù‚ÙŠØ©: ${integer.format(cleanedContacts.length)} Ø±Ù‚Ù… ØµØ§Ù„Ø­.`);
      }
      function renderCrmSendBatches() {
        const container = byId("crm-send-batches");
        const slices = [];
        for (let start = 0; start < cleanedContacts.length; start += 50) {
          slices.push(cleanedContacts.slice(start, start + 50));
        }
        if (!slices.length) {
          container.innerHTML = '<div class="table-empty"><strong>Ù„Ø§ ØªÙˆØ¬Ø¯ Ø¯ÙØ¹Ø§Øª Ø¬Ø§Ù‡Ø²Ø©</strong><span>Ù†Ù‚Ù‘Ù 50 Ø¬Ù‡Ø© Ø§ØªØµØ§Ù„ Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„ Ù„Ø¥Ø±Ø³Ø§Ù„ Ø§Ù„Ø¯ÙØ¹Ø© Ø¥Ù„Ù‰ CRM.</span></div>';
          return;
        }
        container.innerHTML = slices.map((batch, index) => {
          const complete = batch.length === 50;
          const rooms = Array.from({ length: 5 }, (_, roomIndex) => {
            const room = batch.slice(roomIndex * 10, roomIndex * 10 + 10);
            return `<div class="crm-import-room"><strong>ØºØ±ÙØ© ${integer.format(roomIndex + 1)} Â· ${integer.format(room.length)}/10</strong>
              ${room.map(record => `<span title="${escapeHTML(record.name || "")} Â· ${escapeHTML(record.phone)}">${escapeHTML(record.name || record.phone || "Ø¨Ø¯ÙˆÙ† Ø§Ø³Ù…")}</span>`).join("") || '<span>ØªÙ†ØªØ¸Ø± Ø§ÙƒØªÙ…Ø§Ù„ 50 Ø¬Ù‡Ø©</span>'}</div>`;
          }).join("");
          return `<article class="crm-import-batch"><div class="batch-heading"><span>Ø¯ÙØ¹Ø© CRM Ø±Ù‚Ù… ${integer.format(index + 1)} Â· ${integer.format(batch.length)} / 50</span>
            <button class="btn btn-primary crm-send-button" type="button" data-send-crm-batch="${index}" ${complete ? "" : "disabled"}>Ø¥Ø±Ø³Ø§Ù„ Ø§Ù„Ø¯ÙØ¹Ø© Ø¥Ù„Ù‰ Ø§Ù„Ù€ CRM (Send Batch to CRM)</button></div>
            <div class="crm-import-rooms">${rooms}</div>
            ${complete ? '<div class="crm-import-note">Ø³ÙŠØªÙ… Ø¥Ù†Ø´Ø§Ø¡ Ø®Ù…Ø³ ØºØ±Ù Ù…ØªØªØ§Ø¨Ø¹Ø©. ØªÙÙØªØ­ Ø§Ù„ØºØ±ÙØ© Ø§Ù„ØªØ§Ù„ÙŠØ© Ø¨Ø¹Ø¯ Ø¥ÙƒÙ…Ø§Ù„ Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡ Ø§Ù„Ø¹Ø´Ø±Ø© ÙÙŠ Ø§Ù„Ø³Ø§Ø¨Ù‚Ø©.</div>' : `<div class="crm-import-note">ØªØ­ØªØ§Ø¬ ${integer.format(50 - batch.length)} Ø¬Ù‡Ø© Ø§ØªØµØ§Ù„ Ø£Ø®Ø±Ù‰ Ù„Ø¥Ø±Ø³Ø§Ù„ Ø¯ÙØ¹Ø© ÙƒØ§Ù…Ù„Ø©.</div>`}</article>`;
        }).join("");
      }
      byId("crm-send-batches").addEventListener("click", async event => {
        const button = event.target.closest("[data-send-crm-batch]");
        if (!button || button.disabled) return;
        const batchIndex = Number(button.dataset.sendCrmBatch);
        const batch = cleanedContacts.slice(batchIndex * 50, batchIndex * 50 + 50);
        if (batch.length !== 50) { showToast("ÙŠØ¬Ø¨ Ø£Ù† ØªØ­ØªÙˆÙŠ Ø§Ù„Ø¯ÙØ¹Ø© Ø¹Ù„Ù‰ 50 Ø¬Ù‡Ø© Ø§ØªØµØ§Ù„ Ø¨Ø§Ù„Ø¶Ø¨Ø·."); return; }
        const duplicateCount = batch.filter(record => leads.some(lead =>
          (lead.phones || [lead.phone]).filter(Boolean).some(phone => record.phones.includes(phone))
        )).length;
        if (duplicateCount && !window.confirm(`ÙŠÙˆØ¬Ø¯ ${integer.format(duplicateCount)} Ø±Ù‚Ù… Ù…Ø³Ø¬Ù„ Ø¨Ø§Ù„ÙØ¹Ù„. Ù‡Ù„ ØªØ±ÙŠØ¯ Ø¥Ø¶Ø§ÙØ© Ø³Ø¬Ù„Ø§Øª Ø¬Ø¯ÙŠØ¯Ø© Ù„Ù‡Ø°Ù‡ Ø§Ù„Ø¯ÙØ¹Ø© Ù…Ø¹ Ø§Ù„Ø§Ø­ØªÙØ§Ø¸ Ø¨Ø§Ù„Ø³Ø¬Ù„Ø§Øª Ø§Ù„Ø­Ø§Ù„ÙŠØ©ØŸ`)) return;
        const batchId = makeId("crm-batch");
        const batchName = `Ø¯ÙØ¹Ø© CRM ${new Date().toLocaleDateString("ar-EG")}`;
        const crmBatch = { id: batchId, label: batchName, total: 50, createdAt: new Date().toISOString() };
        const importedLeads = batch.map((record, index) => ({
          id: makeId("lead"), name: record.name || "Ø¨Ø¯ÙˆÙ† Ø§Ø³Ù…", phone: record.phone,
          phones: record.phones?.length ? record.phones : [record.phone],
          idNumber: record.id || "", network: record.network || "", email: record.email || "",
          jobTitle: record.jobTitle || "", company: record.company || "", location: record.location || "",
          project: "Ù…Ø³ØªÙˆØ±Ø¯ Ù…Ù† Ù…Ù†Ù‚Ù‘ÙŠ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª", interest: "warm", date: "", status: "new",
          expectedCommission: 0, notes: "", sourceBatchId: batchId,
          batchId, batchName,
          companyId: activeSession.ready ? activeSession.companyId : "",
          assignedTo: activeSession.role === "agent" ? activeSession.uid : "",
          assignedAgentEmail: activeSession.role === "agent" ? activeSession.email : "",
          roomIndex: Math.floor(index / 10) + 1, roomPosition: index % 10 + 1,
          completed: false, vip: false, archived: false, createdAt: new Date().toISOString()
        }));
        const oldLeads = leads;
        const oldBatches = appState.crmBatches;
        leads = [...importedLeads, ...leads];
        appState.crmBatches = [...(appState.crmBatches || []), crmBatch];
        if (!persistLeads() || !persistAppState()) {
          leads = oldLeads;
          appState.crmBatches = oldBatches;
          persistLeads();
          persistAppState(false);
          return;
        }
        renderLeads();
        populateAppointmentClients();
        renderAnalytics();
        await Promise.all(importedLeads.map(lead => writeLeadAudit(lead, "Ø§Ø³ØªÙŠØ±Ø§Ø¯ Ù…Ù† Ù…Ù†Ù‚Ù‘ÙŠ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª", "", `Ø£ÙØ¶ÙŠÙ Ø¥Ù„Ù‰ ${batchName}.`)));
        showToast("ØªÙ… Ø¥Ø±Ø³Ø§Ù„ 50 Ø¹Ù…ÙŠÙ„Ù‹Ø§ Ø¥Ù„Ù‰ CRM ÙÙŠ 5 ØºØ±ÙØŒ 10 Ø¹Ù…Ù„Ø§Ø¡ Ù„ÙƒÙ„ ØºØ±ÙØ©.");
        switchTab("crm");
      });
      byId("clean-contacts").addEventListener("click", () => runCleaner(true));
      byId("clear-cleaner").addEventListener("click", () => {
        byId("raw-contacts").value = "";
        byId("contact-file").value = "";
        cleanedContacts = [];
        appState.cleanerRows = [];
        appState.rawContacts = "";
        appState.lastCleanerStats = { duplicates: 0, invalid: 0, batches: 0 };
        persistAppState();
        ["clean-count", "duplicate-count", "invalid-count", "batch-count"].forEach(id => byId(id).textContent = "Ù ");
        byId("download-csv").disabled = true;
        byId("download-xlsx").disabled = true;
        byId("copy-cleaned").disabled = true;
        byId("cleaner-preview-body").innerHTML = "";
        byId("cleaner-preview-empty").hidden = false;
        byId("batch-list").innerHTML = '<div class="table-empty"><strong>Ù„Ø§ ØªÙˆØ¬Ø¯ Ù†ØªØ§Ø¦Ø¬ Ø¨Ø¹Ø¯</strong><span>Ø£Ø¶Ù Ø¨ÙŠØ§Ù†Ø§Øª ÙˆØ§Ø¶ØºØ· "ØªÙ†Ù‚ÙŠØ© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª".</span></div>';
        renderCrmSendBatches();
      });
      byId("batch-size").addEventListener("change", () => {
        if (cleanedContacts.length) runCleaner(false);
      });
      byId("phone-region").addEventListener("change", () => {
        if (byId("raw-contacts").value.trim()) runCleaner(false);
      });
      byId("contact-file").addEventListener("change", async event => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        try {
          byId("raw-contacts").value = /\.xlsx$/i.test(file.name)
            ? await readExcelRows(file)
            : await file.text();
          showToast(`ØªÙ… ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ù…Ù„Ù "${file.name}". Ø§Ø¶ØºØ· ØªÙ†Ù‚ÙŠØ© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ù„Ù„Ù…ØªØ§Ø¨Ø¹Ø©.`);
        } catch (error) {
          console.error("Could not read uploaded contact list:", error);
          showToast(`ØªØ¹Ø°Ø±Øª Ù‚Ø±Ø§Ø¡Ø© Ø§Ù„Ù…Ù„Ù: ${error.message || "ØªØ­Ù‚Ù‚ Ù…Ù† Ø£Ù† Ø§Ù„Ù…Ù„Ù Excel XLSX Ø£Ùˆ CSV/TXT ØµØ§Ù„Ø­."}`);
        }
      });
      byId("download-csv").addEventListener("click", () => {
        if (!cleanedContacts.length) return;
        downloadCSV("mjk-cleaned-contacts.csv", [cleanerColumns.map(column => column.label), ...cleanedContacts.map(record =>
          [record.id, record.name, (record.phones || [record.phone]).join(", "), record.network, record.email, record.jobTitle, record.company, record.location]
        )]);
        showToast("ØªÙ… ØªÙ†Ø²ÙŠÙ„ Ù‚Ø§Ø¦Ù…Ø© Ø¬Ù‡Ø§Øª Ø§Ù„Ø§ØªØµØ§Ù„ Ø§Ù„Ù…Ù†Ù‚Ø­Ø©.");
      });
      function xmlEscape(value) {
        return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
      }
      function columnName(index) {
        let name = "";
        for (index++; index; index = Math.floor((index - 1) / 26)) name = String.fromCharCode(65 + (index - 1) % 26) + name;
        return name;
      }
      function crc32(bytes) {
        let crc = -1;
        for (const byte of bytes) {
          crc ^= byte;
          for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
        return (crc ^ -1) >>> 0;
      }
      function makeStoredZip(files) {
        const encoder = new TextEncoder();
        const localParts = [];
        const centralParts = [];
        let localOffset = 0;
        const write16 = (view, offset, value) => view.setUint16(offset, value, true);
        const write32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);
        files.forEach(file => {
          const name = encoder.encode(file.name);
          const data = encoder.encode(file.content);
          const checksum = crc32(data);
          const local = new Uint8Array(30 + name.length + data.length);
          const localView = new DataView(local.buffer);
          write32(localView, 0, 0x04034b50); write16(localView, 4, 20); write16(localView, 6, 0x0800);
          write16(localView, 8, 0); write16(localView, 12, 0x0021); write32(localView, 14, checksum); write32(localView, 18, data.length);
          write32(localView, 22, data.length); write16(localView, 26, name.length);
          local.set(name, 30); local.set(data, 30 + name.length);
          localParts.push(local);
          const central = new Uint8Array(46 + name.length);
          const centralView = new DataView(central.buffer);
          write32(centralView, 0, 0x02014b50); write16(centralView, 4, 20); write16(centralView, 6, 20);
          write16(centralView, 8, 0x0800); write16(centralView, 10, 0); write16(centralView, 14, 0x0021);
          write32(centralView, 16, checksum); write32(centralView, 20, data.length); write32(centralView, 24, data.length);
          write16(centralView, 28, name.length); write32(centralView, 42, localOffset);
          central.set(name, 46); centralParts.push(central); localOffset += local.length;
        });
        const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
        const end = new Uint8Array(22);
        const endView = new DataView(end.buffer);
        write32(endView, 0, 0x06054b50); write16(endView, 8, files.length); write16(endView, 10, files.length);
        write32(endView, 12, centralSize); write32(endView, 16, localOffset);
        return new Blob([...localParts, ...centralParts, end], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        });
      }
      async function readExcelRows(file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let endOffset = -1;
        for (let offset = Math.max(0, bytes.length - 65557); offset <= bytes.length - 22; offset++) {
          if (view.getUint32(offset, true) === 0x06054b50) endOffset = offset;
        }
        if (endOffset < 0) throw new Error("Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ø¨Ù†ÙŠØ© XLSX ØµØ§Ù„Ø­Ø©.");
        const entryCount = view.getUint16(endOffset + 10, true);
        const directoryOffset = view.getUint32(endOffset + 16, true);
        const decoder = new TextDecoder();
        const entries = new Map();
        let cursor = directoryOffset;
        for (let index = 0; index < entryCount; index++) {
          if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Ù‚Ø§Ø¦Ù…Ø© Ù…Ù„ÙØ§Øª Excel Ø§Ù„Ø¯Ø§Ø®Ù„ÙŠØ© ØºÙŠØ± ØµØ§Ù„Ø­Ø©.");
          const method = view.getUint16(cursor + 10, true);
          const compressedSize = view.getUint32(cursor + 20, true);
          const nameLength = view.getUint16(cursor + 28, true);
          const extraLength = view.getUint16(cursor + 30, true);
          const commentLength = view.getUint16(cursor + 32, true);
          const localOffset = view.getUint32(cursor + 42, true);
          const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
          const localNameLength = view.getUint16(localOffset + 26, true);
          const localExtraLength = view.getUint16(localOffset + 28, true);
          const dataStart = localOffset + 30 + localNameLength + localExtraLength;
          const compressed = bytes.slice(dataStart, dataStart + compressedSize);
          let content;
          if (method === 0) content = compressed;
          else if (method === 8 && typeof DecompressionStream !== "undefined") {
            const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
            content = new Uint8Array(await new Response(stream).arrayBuffer());
          } else throw new Error("Ø·Ø±ÙŠÙ‚Ø© Ø¶ØºØ· Ù…Ù„Ù XLSX ØºÙŠØ± Ù…Ø¯Ø¹ÙˆÙ…Ø© ÙÙŠ Ù‡Ø°Ø§ Ø§Ù„Ù…ØªØµÙØ­.");
          entries.set(name, decoder.decode(content));
          cursor += 46 + nameLength + extraLength + commentLength;
        }
        const workbookXml = entries.get("xl/workbook.xml");
        const relationshipsXml = entries.get("xl/_rels/workbook.xml.rels");
        if (!workbookXml || !relationshipsXml) throw new Error("Ù…Ù„Ù Excel Ù„Ø§ ÙŠØ­ØªÙˆÙŠ Ø¹Ù„Ù‰ ÙˆØ±Ù‚Ø© Ø¹Ù…Ù„ Ù‚Ø§Ø¨Ù„Ø© Ù„Ù„Ù‚Ø±Ø§Ø¡Ø©.");
        const parser = new DOMParser();
        const workbook = parser.parseFromString(workbookXml, "application/xml");
        const relationships = parser.parseFromString(relationshipsXml, "application/xml");
        const firstSheet = workbook.getElementsByTagNameNS("*", "sheet")[0];
        if (!firstSheet) throw new Error("Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ ÙˆØ±Ù‚Ø© Ø¹Ù…Ù„ Ø¯Ø§Ø®Ù„ Ù…Ù„Ù Excel.");
        const relationId = firstSheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
        const relation = [...relationships.getElementsByTagNameNS("*", "Relationship")].find(item => item.getAttribute("Id") === relationId);
        if (!relation) throw new Error("ØªØ¹Ø°Ø± ØªØ­Ø¯ÙŠØ¯ Ù…Ø³Ø§Ø± ÙˆØ±Ù‚Ø© Excel.");
        const relationshipTarget = relation.getAttribute("Target").replace(/^\//, "");
        const targetParts = relationshipTarget.startsWith("xl/")
          ? relationshipTarget
          : `xl/${relationshipTarget}`;
        const normalizedPath = [];
        targetParts.split("/").forEach(part => {
          if (part === "..") normalizedPath.pop();
          else if (part && part !== ".") normalizedPath.push(part);
        });
        const sheetXml = entries.get(normalizedPath.join("/"));
        if (!sheetXml) throw new Error("ØªØ¹Ø°Ø± ÙØªØ­ Ø¨ÙŠØ§Ù†Ø§Øª ÙˆØ±Ù‚Ø© Excel.");
        const sharedStrings = entries.get("xl/sharedStrings.xml");
        const shared = sharedStrings
          ? [...parser.parseFromString(sharedStrings, "application/xml").getElementsByTagNameNS("*", "si")]
              .map(item => [...item.getElementsByTagNameNS("*", "t")].map(text => text.textContent).join(""))
          : [];
        const sheet = parser.parseFromString(sheetXml, "application/xml");
        const rows = [...sheet.getElementsByTagNameNS("*", "row")].map(row => {
          const values = [];
          [...row.getElementsByTagNameNS("*", "c")].forEach(cell => {
            const reference = cell.getAttribute("r") || "";
            const letters = reference.match(/^[A-Z]+/i)?.[0] || "A";
            const columnIndex = [...letters.toUpperCase()].reduce((number, letter) => number * 26 + letter.charCodeAt(0) - 64, 0) - 1;
            const type = cell.getAttribute("t");
            const valueNode = cell.getElementsByTagNameNS("*", "v")[0];
            const inline = cell.getElementsByTagNameNS("*", "is")[0];
            let value = valueNode?.textContent || (inline ? [...inline.getElementsByTagNameNS("*", "t")].map(text => text.textContent).join("") : "");
            if (type === "s" && value !== "") value = shared[Number(value)] ?? "";
            values[columnIndex] = value;
          });
          while (values.length && values[values.length - 1] === undefined) values.pop();
          return values.map(value => String(value ?? ""));
        }).filter(row => row.some(value => value.trim()));
        return rows.map(row => row.length === 1
          ? row[0]
          : row.map(value => `"${value.replace(/"/g, '""')}"`).join(",")
        ).join("\n");
      }
      function exportCleanerXlsx() {
        const worksheetRows = [cleanerColumns.map(column => column.label), ...cleanedContacts.map(record => [
          record.id, record.name, (record.phones || [record.phone]).join(", "), record.network,
          record.email, record.jobTitle, record.company, record.location
        ])];
        const sheetData = worksheetRows.map((row, rowIndex) => {
          const cells = row.map((value, columnIndex) => `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`).join("");
          return `<row r="${rowIndex + 1}">${cells}</row>`;
        }).join("");
        const files = [
          { name: "[Content_Types].xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
          { name: "_rels/.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
          { name: "xl/workbook.xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ø¬Ù‡Ø§Øª Ø§Ù„Ø§ØªØµØ§Ù„" sheetId="1" r:id="rId1"/></sheets></workbook>' },
          { name: "xl/_rels/workbook.xml.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
          { name: "xl/worksheets/sheet1.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>` }
        ];
        const blob = makeStoredZip(files);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url; link.download = "mjk-cleaned-contacts.xlsx";
        document.body.appendChild(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1500);
        showToast("ØªÙ… ØªÙ†Ø²ÙŠÙ„ Ù…Ù„Ù Excel Ù…Ù†Ø¸Ù… Ø¨ØµÙŠØºØ© XLSX.");
      }
      byId("download-xlsx").addEventListener("click", () => {
        if (cleanedContacts.length) exportCleanerXlsx();
      });
      byId("copy-cleaned").addEventListener("click", async () => {
        if (!cleanedContacts.length) return;
        const text = cleanedContacts.map(record => `${record.name ? `${record.name}, ` : ""}${record.phone}`).join("\n");
        try {
          await navigator.clipboard.writeText(text);
          showToast("ØªÙ… Ù†Ø³Ø® Ø§Ù„Ø£Ø±Ù‚Ø§Ù… Ø§Ù„Ù…Ù†Ù‚Ø­Ø©.");
        } catch (error) {
          console.error("Clipboard access was denied:", error);
          showToast("Ù„Ù… ÙŠØ³Ù…Ø­ Ø§Ù„Ù…ØªØµÙØ­ Ø¨Ø§Ù„Ù†Ø³Ø®. Ø§Ø³ØªØ®Ø¯Ù… ØªÙ†Ø²ÙŠÙ„ CSV Ø¨Ø¯Ù„Ù‹Ø§ Ù…Ù† Ø°Ù„Ùƒ.");
        }
      });

      const lookupLabels = {
        client: "Ø¹Ù…ÙŠÙ„ Ù…Ø¨Ø§Ø´Ø±", broker: "Ø¨Ø±ÙˆÙƒØ± / ÙˆØ³ÙŠØ·", unknown: "ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ", "do-not-contact": "Ø¹Ø¯Ù… Ø§Ù„ØªÙˆØ§ØµÙ„"
      };
      function renderLookup() {
        const query = byId("lookup-search").value.trim().toLocaleLowerCase();
        const category = byId("lookup-filter").value;
        const filtered = appState.lookups.filter(item => {
          const matchesType = category === "all" || item.type === category;
          return matchesType && `${item.phone} ${item.name} ${item.notes}`.toLocaleLowerCase().includes(query);
        }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        byId("lookup-rows").innerHTML = filtered.map(item => `<tr>
          <td dir="ltr" style="white-space:nowrap">${escapeHTML(item.phone)}</td>
          <td>${escapeHTML(item.name || "â€”")}</td>
          <td><span class="tag-label">${escapeHTML(lookupLabels[item.type] || lookupLabels.unknown)}</span></td>
          <td><span class="client-note" title="${escapeHTML(item.notes || "")}">${escapeHTML(item.notes || "â€”")}</span></td>
          <td><button class="btn btn-danger small-btn" type="button" data-lookup-delete="${escapeHTML(item.id)}">Ø­Ø°Ù</button></td>
        </tr>`).join("");
        byId("lookup-empty").hidden = filtered.length > 0;
        byId("lookup-count").textContent = `${integer.format(filtered.length)} Ù…Ù† ${integer.format(appState.lookups.length)} Ø±Ù‚Ù…`;
      }
      byId("lookup-form").addEventListener("submit", event => {
        event.preventDefault();
        if (!event.currentTarget.reportValidity()) return;
        const phone = normalizePhone(byId("lookup-phone").value, byId("lookup-region").value);
        if (!phone) {
          byId("lookup-phone").setCustomValidity("Ø£Ø¯Ø®Ù„ Ø±Ù‚Ù…Ù‹Ø§ Ù…ØµØ±ÙŠÙ‹Ø§ Ø£Ùˆ Ø®Ù„ÙŠØ¬ÙŠÙ‹Ø§ ØµØ­ÙŠØ­Ù‹Ø§ØŒ Ø£Ùˆ Ø§Ø³ØªØ®Ø¯Ù… Ø§Ù„ØµÙŠØºØ© Ø§Ù„Ø¯ÙˆÙ„ÙŠØ©.");
          byId("lookup-phone").reportValidity();
          return;
        }
        byId("lookup-phone").setCustomValidity("");
        const existing = appState.lookups.find(item => item.phone === phone);
        const record = existing || { id: makeId("lookup"), createdAt: new Date().toISOString() };
        record.phone = phone;
        record.name = byId("lookup-name").value.trim();
        record.type = byId("lookup-type").value;
        record.notes = byId("lookup-notes").value.trim();
        record.updatedAt = new Date().toISOString();
        if (!existing) appState.lookups.unshift(record);
        if (!persistAppState()) {
          if (!existing) appState.lookups = appState.lookups.filter(item => item.id !== record.id);
          return;
        }
        event.currentTarget.reset();
        renderLookup();
        renderAnalytics();
        showToast(existing ? "ØªÙ… ØªØ­Ø¯ÙŠØ« ØªØµÙ†ÙŠÙ Ø§Ù„Ø±Ù‚Ù… ÙˆÙ…Ù„Ø§Ø­Ø¸Ø§ØªÙ‡." : "ØªÙ… Ø­ÙØ¸ Ø§Ù„Ø±Ù‚Ù… ÙÙŠ Ø¯ÙØªØ± Ø§Ù„ØªØ­Ù‚Ù‚.");
      });
      byId("lookup-phone").addEventListener("input", () => byId("lookup-phone").setCustomValidity(""));
      byId("lookup-check").addEventListener("click", () => {
        const phone = normalizePhone(byId("lookup-phone").value, byId("lookup-region").value);
        if (!phone) { byId("lookup-result").textContent = "Ø£Ø¯Ø®Ù„ Ø±Ù‚Ù…Ù‹Ø§ ØµØ­ÙŠØ­Ù‹Ø§ Ø£ÙˆÙ„Ù‹Ø§Ø› Ø§Ù„ØªØµÙ†ÙŠÙ Ù…ØªØ§Ø­ Ù„Ù…ØµØ± ÙˆØ§Ù„Ø®Ù„ÙŠØ¬."; return; }
        const found = appState.lookups.find(item => item.phone === phone);
        byId("lookup-result").textContent = found
          ? `Ù…ÙˆØ¬ÙˆØ¯ ÙÙŠ Ø§Ù„Ø¯ÙØªØ±: ${found.name || "Ø¨Ø¯ÙˆÙ† Ø§Ø³Ù…"} Â· ${lookupLabels[found.type] || lookupLabels.unknown}${found.notes ? ` Â· ${found.notes}` : ""}`
          : "Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ø³Ø¬Ù„ Ù„Ù‡Ø°Ø§ Ø§Ù„Ø±Ù‚Ù… Ø¹Ù„Ù‰ Ø¬Ù‡Ø§Ø²Ùƒ. Ù‡Ø°Ø§ Ø§Ù„ÙØ­Øµ Ù…Ø­Ù„ÙŠ ÙˆÙ„Ø§ ÙŠØ¬Ø±ÙŠ Ø§Ø³ØªØ¹Ù„Ø§Ù…Ù‹Ø§ Ø®Ø§Ø±Ø¬ÙŠÙ‹Ø§.";
        byId("lookup-phone").value = phone;
        byId("lookup-region").value = "auto";
        if (found) {
          byId("lookup-name").value = found.name || "";
          byId("lookup-type").value = found.type || "unknown";
          byId("lookup-notes").value = found.notes || "";
        }
      });
      byId("lookup-search").addEventListener("input", renderLookup);
      byId("lookup-filter").addEventListener("change", renderLookup);
      byId("lookup-rows").addEventListener("click", event => {
        const button = event.target.closest("[data-lookup-delete]");
        if (!button) return;
        if (!window.confirm("Ù‡Ù„ ØªØ±ÙŠØ¯ Ø­Ø°Ù Ù‡Ø°Ø§ Ø§Ù„Ø±Ù‚Ù… ÙˆÙ…Ù„Ø§Ø­Ø¸Ø§ØªÙ‡ Ù…Ù† Ø¯ÙØªØ± Ø§Ù„ØªØ­Ù‚Ù‚ØŸ")) return;
        appState.lookups = appState.lookups.filter(item => item.id !== button.dataset.lookupDelete);
        persistAppState();
        renderLookup();
        renderAnalytics();
        showToast("ØªÙ… Ø­Ø°Ù Ø§Ù„Ø±Ù‚Ù… Ù…Ù† Ø¯ÙØªØ± Ø§Ù„ØªØ­Ù‚Ù‚.");
      });

      function populateAppointmentClients() {
        const select = byId("appointment-client");
        const previous = select.value;
        select.innerHTML = '<option value="">Ø¨Ø¯ÙˆÙ† Ø±Ø¨Ø· Ø¨Ø¹Ù…ÙŠÙ„</option>' + leads.map(lead => `<option value="${escapeHTML(lead.id)}">${escapeHTML(lead.name)} Â· ${escapeHTML(lead.phone)}</option>`).join("");
        if (leads.some(lead => lead.id === previous)) select.value = previous;
      }
      const appointmentTypes = { call: "Ù…ÙƒØ§Ù„Ù…Ø©", inspection: "Ù…Ø¹Ø§ÙŠÙ†Ø©", meeting: "Ø§Ø¬ØªÙ…Ø§Ø¹", followup: "Ù…ØªØ§Ø¨Ø¹Ø©" };
      function renderAppointments() {
        const filter = byId("appointment-filter").value;
        const today = localDateInput();
        const items = appState.appointments.filter(item => {
          if (filter === "done") return item.done;
          if (filter === "upcoming") return !item.done;
          return true;
        }).sort((a, b) => `${a.date}T${a.time || "00:00"}`.localeCompare(`${b.date}T${b.time || "00:00"}`));
        byId("agenda-list").innerHTML = items.map(item => {
          const lead = leads.find(record => record.id === item.clientId);
          const overdue = !item.done && item.date < today;
          return `<article class="agenda-item ${item.done ? "is-done" : ""} ${overdue ? "is-overdue" : ""}">
            <div class="agenda-item-head"><div><div class="agenda-title">${escapeHTML(item.title)}</div><div class="agenda-meta">${escapeHTML(appointmentTypes[item.type] || "Ù…ÙˆØ¹Ø¯")} Â· ${lead ? `Ø§Ù„Ø¹Ù…ÙŠÙ„: ${escapeHTML(lead.name)}` : "Ù…ÙˆØ¹Ø¯ Ù…Ø³ØªÙ‚Ù„"}${item.notes ? ` Â· ${escapeHTML(item.notes)}` : ""}</div></div><div class="agenda-date">${escapeHTML(new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${item.date}T12:00:00`)))}<br>${escapeHTML(item.time || "")}${overdue ? "<br>Ù…ØªØ£Ø®Ø±" : ""}</div></div>
            <div class="archive-actions"><button class="btn btn-secondary small-btn" type="button" data-appointment-toggle="${escapeHTML(item.id)}">${item.done ? "Ø¥Ø¹Ø§Ø¯Ø© ÙØªØ­" : "ØªÙ…Øª"}</button>${lead ? `<a class="btn btn-whatsapp" href="https://wa.me/${encodeURIComponent(lead.phone.replace(/\D/g, ""))}" target="_blank" rel="noopener noreferrer">ÙˆØ§ØªØ³Ø§Ø¨ Ø§Ù„Ø¹Ù…ÙŠÙ„</a>` : ""}<button class="btn btn-danger small-btn" type="button" data-appointment-delete="${escapeHTML(item.id)}">Ø­Ø°Ù</button></div>
          </article>`;
        }).join("");
        const lookupTable = byId("lookup-rows").closest(".table-wrap");
        lookupTable.scrollLeft = lookupTable.scrollWidth;
        byId("agenda-empty").hidden = items.length > 0;
      }
      byId("appointment-form").addEventListener("submit", event => {
        event.preventDefault();
        if (!event.currentTarget.reportValidity()) return;
        const entry = {
          id: makeId("appointment"), title: byId("appointment-title").value.trim(),
          clientId: byId("appointment-client").value, type: byId("appointment-type").value,
          date: byId("appointment-date").value, time: byId("appointment-time").value || "10:00",
          notes: byId("appointment-notes").value.trim(), done: false, createdAt: new Date().toISOString()
        };
        appState.appointments.push(entry);
        if (!persistAppState()) { appState.appointments = appState.appointments.filter(item => item.id !== entry.id); return; }
        event.currentTarget.reset();
        byId("appointment-time").value = "10:00";
        populateAppointmentClients();
        renderAppointments();
        renderAnalytics();
        showToast("ØªÙ…Øª Ø¥Ø¶Ø§ÙØ© Ø§Ù„Ù…ÙˆØ¹Ø¯ Ø¥Ù„Ù‰ Ø£Ø¬Ù†Ø¯ØªÙƒ Ø§Ù„Ù…Ø­Ù„ÙŠØ©.");
      });
      byId("appointment-filter").addEventListener("change", renderAppointments);
      byId("agenda-list").addEventListener("click", event => {
        const toggle = event.target.closest("[data-appointment-toggle]");
        const remove = event.target.closest("[data-appointment-delete]");
        const entry = appState.appointments.find(item => item.id === (toggle?.dataset.appointmentToggle || remove?.dataset.appointmentDelete));
        if (!entry) return;
        if (toggle) entry.done = !entry.done;
        else if (remove) appState.appointments = appState.appointments.filter(item => item.id !== entry.id);
        if ((entry.done || remove) && activeAlertKey.startsWith(`appointment-${entry.id}-`)) stopAlert();
        persistAppState();
        renderAppointments();
        renderAnalytics();
      });
      byId("enable-notifications").addEventListener("click", async () => {
        try {
          const permission = "Notification" in window ? await Notification.requestPermission() : "unsupported";
          if (alertAudioContext?.state === "suspended") await alertAudioContext.resume();
          if (permission === "granted" || permission === "unsupported") {
            playAlertChime();
            showToast("ØªÙ… ØªÙØ¹ÙŠÙ„ ØµÙˆØª Ø§Ù„ØªÙ†Ø¨ÙŠÙ‡Ø§ØªØ› Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ø§Ù„Ù…ØªØµÙØ­ Ù…ØªØ§Ø­Ø© Ø¹Ù†Ø¯ Ø¯Ø¹Ù…Ù‡Ø§ ÙˆÙ…Ù†Ø­ Ø§Ù„Ø¥Ø°Ù†.");
          } else showToast("Ù„Ù… ÙŠÙ…Ù†Ø­ Ø§Ù„Ù…ØªØµÙØ­ Ø¥Ø°Ù† Ø§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª.");
        } catch (error) {
          console.error("Notification permission request failed:", error);
          showToast("ØªØ¹Ø°Ø± Ø·Ù„Ø¨ Ø¥Ø°Ù† Ø§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ù…Ù† Ø§Ù„Ù…ØªØµÙØ­.");
        }
      });
      function checkAppointmentReminders() {
        const now = new Date();
        appState.appointments.forEach(item => {
          if (item.done) return;
          const due = new Date(`${item.date}T${item.time || "10:00"}:00`);
          const delta = due.getTime() - now.getTime();
          const key = `mjk-reminder-${item.id}-${item.date}-${item.time}`;
          if (Math.abs(delta) > 60000 || firedReminders.has(key)) return;
          firedReminders.add(key);
          startAlert(`appointment-${item.id}-${item.date}-${item.time}`, "ØªØ°ÙƒÙŠØ± MJK", `Ù…ÙˆØ¹Ø¯Ùƒ Ø§Ù„Ø¢Ù†: ${item.title}`, () => switchTab("scheduler"));
        });
        leads.filter(lead => canViewLead(lead) && !lead.archived && !lead.completed && lead.status !== "lost" && lead.date)
          .forEach(lead => {
            const time = lead.followupTime || lead.followUpTime || "10:00";
            const due = new Date(`${lead.date}T${time}:00`);
            const key = `mjk-followup-${lead.id}-${lead.date}-${time}`;
            if (!Number.isFinite(due.getTime()) || Math.abs(due.getTime() - now.getTime()) > 60000 || firedReminders.has(key)) return;
            firedReminders.add(key);
            startAlert(`followup-${lead.id}-${lead.date}-${time}`, "ØªØ°ÙƒÙŠØ± Ù…ØªØ§Ø¨Ø¹Ø© MJK", `Ø­Ø§Ù† Ù…ÙˆØ¹Ø¯ Ù…ØªØ§Ø¨Ø¹Ø© ${lead.name || "Ø§Ù„Ø¹Ù…ÙŠÙ„"}.`, () => switchTab("crm"));
        });
      }
      reminderTimer = window.setInterval(checkAppointmentReminders, 30000);
      checkAppointmentReminders();

      const scriptFilterWords = id => byId(id).value.trim().toLocaleLowerCase();
      const scenarioDimensions = {
        topic: {
          price: "Ø§Ø¹ØªØ±Ø§Ø¶ Ø§Ù„Ø³Ø¹Ø±", visit: "Ø¯Ø¹ÙˆØ© Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©", comparison: "Ù…Ù‚Ø§Ø±Ù†Ø© Ø§Ù„Ø¨Ø¯Ø§Ø¦Ù„",
          followup: "Ù…ØªØ§Ø¨Ø¹Ø© ÙˆØ§ØªØ³Ø§Ø¨", closing: "Ø§Ù„Ø®Ø·ÙˆØ© Ø§Ù„ØªØ§Ù„ÙŠØ©", installment: "Ø§Ù„Ø³Ø¯Ø§Ø¯ ÙˆØ§Ù„Ø£Ù‚Ø³Ø§Ø·",
          location: "Ø§Ù„Ù…ÙˆÙ‚Ø¹", investment: "Ø§Ù„Ø´Ø±Ø§Ø¡ Ù„Ù„Ø§Ø³ØªØ«Ù…Ø§Ø±"
        },
        buyer: {
          family: "Ø£Ø³Ø±Ø© ØªØ¨Ø­Ø« Ø¹Ù† Ø³ÙƒÙ†", investor: "Ù…Ø³ØªØ«Ù…Ø±", first: "Ù…Ø´ØªØ±ÙŠ Ù„Ø£ÙˆÙ„ Ù…Ø±Ø©",
          local: "Ø¹Ù…ÙŠÙ„ Ù…Ù† Ø§Ù„Ù…Ù†Ø·Ù‚Ø©", comparing: "Ø¹Ù…ÙŠÙ„ ÙŠÙ‚Ø§Ø±Ù† Ø§Ù„Ø¨Ø¯Ø§Ø¦Ù„"
        },
        region: {
          sohag: "Ø³ÙˆÙ‡Ø§Ø¬", upper: "Ù…Ø­Ø§ÙØ¸Ø§Øª Ø§Ù„ØµØ¹ÙŠØ¯", cairo: "Ø§Ù„Ù‚Ø§Ù‡Ø±Ø©", giza: "Ø§Ù„Ø¬ÙŠØ²Ø©",
          newcities: "Ø§Ù„Ù…Ø¯Ù† Ø§Ù„Ø¬Ø¯ÙŠØ¯Ø©", coast: "Ø§Ù„Ø³Ø§Ø­Ù„ Ø£Ùˆ Ø§Ù„Ø¨Ø­Ø± Ø§Ù„Ø£Ø­Ù…Ø±", other: "Ø§Ù„Ù…Ù†Ø·Ù‚Ø© Ø§Ù„Ù…Ø­Ø¯Ø¯Ø©"
        },
        channel: { whatsapp: "ÙˆØ§ØªØ³Ø§Ø¨", phone: "Ù…ÙƒØ§Ù„Ù…Ø© Ù‡Ø§ØªÙÙŠØ©", meeting: "Ù…Ù‚Ø§Ø¨Ù„Ø© Ù…Ø¨Ø§Ø´Ø±Ø©", email: "Ø¨Ø±ÙŠØ¯ Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ" },
        stage: { first: "ØªÙˆØ§ØµÙ„ Ø£ÙˆÙ„", afterdetails: "Ø¨Ø¹Ø¯ Ø¥Ø±Ø³Ø§Ù„ Ø§Ù„ØªÙØ§ØµÙŠÙ„", aftervisit: "Ø¨Ø¹Ø¯ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©", decision: "Ù‚Ø¨Ù„ Ø§ØªØ®Ø§Ø° Ø§Ù„Ù‚Ø±Ø§Ø±" },
        tone: { professional: "Ù…Ù‡Ù†ÙŠØ©", friendly: "ÙˆØ¯ÙˆØ¯Ø©", concise: "Ù…Ø®ØªØµØ±Ø©" }
      };
      const smartReplyCount = Object.values(scenarioDimensions).reduce((count, dimension) => count * Object.keys(dimension).length, 1);
      const scenarioTopics = {
        price: "Ù…ØªÙÙ‡Ù… Ø¥Ù† Ø§Ù„Ù…ÙŠØ²Ø§Ù†ÙŠØ© Ø¹Ø§Ù…Ù„ Ø£Ø³Ø§Ø³ÙŠ. Ø®Ù„Ù‘ÙŠÙ†Ø§ Ù†Ø±Ø§Ø¬Ø¹ Ø§Ù„Ø³Ø¹Ø± Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠ ÙˆØ§Ù„Ù…Ù‚Ø¯Ù… ÙˆØ§Ù„Ø£Ù‚Ø³Ø§Ø· ÙˆØ£ÙŠ Ù…ØµØ±ÙˆÙØ§Øª Ù…ÙƒØªÙˆØ¨Ø©ØŒ Ø«Ù… Ù†Ø­Ø¯Ø¯ Ø§Ø®ØªÙŠØ§Ø±Ù‹Ø§ ÙŠÙ†Ø§Ø³Ø¨ Ø§Ù„Ù†Ø·Ø§Ù‚ Ø§Ù„Ø°ÙŠ ØªÙØ¶Ù‘Ù„Ù‡ Ù…Ù† ØºÙŠØ± Ø¶ØºØ·.",
        visit: "ÙŠØ³Ø¹Ø¯Ù†ÙŠ Ø£Ù† Ø£Ø±ØªØ¨ Ù„Ùƒ Ù…Ø¹Ø§ÙŠÙ†Ø© Ù„Ù„Ù…Ø´Ø±ÙˆØ¹ Ø£Ùˆ Ø§Ù„ÙˆØ­Ø¯Ø©. Ù†Ø®ØªØ§Ø± Ù…ÙˆØ¹Ø¯Ù‹Ø§ Ù…Ù†Ø§Ø³Ø¨Ù‹Ø§ØŒ ÙˆØ£Ø¬Ù‡Ø² Ù„Ùƒ Ù‚Ø§Ø¦Ù…Ø© ÙˆØ§Ø¶Ø­Ø© Ø¨Ø§Ù„Ù†Ù‚Ø§Ø· Ø§Ù„ØªÙŠ ØªÙ‡Ù…Ùƒ Ù„ØªØ±Ø§Ø¬Ø¹Ù‡Ø§ Ø¹Ù„Ù‰ Ø£Ø±Ø¶ Ø§Ù„ÙˆØ§Ù‚Ø¹.",
        comparison: "Ø§Ù„Ù…Ù‚Ø§Ø±Ù†Ø© Ù…ÙÙŠØ¯Ø© Ø¹Ù†Ø¯Ù…Ø§ ØªÙƒÙˆÙ† Ø¹Ù„Ù‰ Ø£Ø³Ø§Ø³ Ù…ÙˆØ­Ø¯: Ø§Ù„Ø³Ø¹Ø± Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠØŒ Ø§Ù„Ù…Ø³Ø§Ø­Ø© Ø§Ù„ØµØ§ÙÙŠØ©ØŒ Ø§Ù„ØªØ³Ù„ÙŠÙ…ØŒ Ø§Ù„Ù…ØµØ±ÙˆÙØ§ØªØŒ ÙˆØ®Ø·Ø© Ø§Ù„Ø³Ø¯Ø§Ø¯. Ø£Ø´Ø§Ø±ÙƒÙƒ Ø¨ÙŠØ§Ù†Ø§Øª Ù…Ø´Ø±ÙˆØ¹Ù†Ø§ Ø§Ù„Ù…ÙˆØ«Ù‚Ø©ØŒ ÙˆÙ†ØªØ±Ùƒ Ø£ÙŠ Ù…Ø¹Ù„ÙˆÙ…Ø© Ø¹Ù† Ø§Ù„Ø¨Ø¯Ø§Ø¦Ù„ ØºÙŠØ± Ø§Ù„Ù…Ø¤ÙƒØ¯Ø© Ø®Ø§Ø±Ø¬ Ø§Ù„Ù…Ù‚Ø§Ø±Ù†Ø©.",
        followup: "Ø­Ø¨ÙŠØª Ø£ØªØ§Ø¨Ø¹ Ù…Ø¹Ùƒ Ø¨Ø¹Ø¯ Ø§Ù„Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ø§Ù„ØªÙŠ Ø£Ø±Ø³Ù„ØªÙ‡Ø§. Ù…Ø§ Ø§Ù„Ù†Ù‚Ø·Ø© Ø§Ù„ØªÙŠ ØªØ­ØªØ§Ø¬ ØªÙˆØ¶ÙŠØ­Ù‹Ø§ Ø£ÙƒØ«Ø±ØŸ Ø£Ù‚Ø¯Ø± Ø£Ø±Ø³Ù„ Ù„Ùƒ Ø§Ù„ØªÙØ§ØµÙŠÙ„ Ø§Ù„Ù…Ø­Ø¯Ø¯Ø© Ø£Ùˆ Ù†Ø­Ø¯Ø¯ Ù…ÙƒØ§Ù„Ù…Ø© Ù‚ØµÙŠØ±Ø© ÙÙŠ Ø§Ù„ÙˆÙ‚Øª Ø§Ù„Ù…Ù†Ø§Ø³Ø¨.",
        closing: "Ø¥Ø°Ø§ ÙƒØ§Ù† Ø§Ù„Ø§Ø®ØªÙŠØ§Ø± Ù…Ù†Ø§Ø³Ø¨Ù‹Ø§ØŒ Ù†Ø±Ø§Ø¬Ø¹ Ù…Ø¹Ù‹Ø§ Ø§Ù„ÙˆØ­Ø¯Ø© ÙˆØ§Ù„Ø³Ø¹Ø± ÙˆØ§Ù„Ø¬Ø¯ÙˆÙ„ Ø§Ù„Ø²Ù…Ù†ÙŠ ÙˆÙƒÙ„ Ø§Ù„Ø´Ø±ÙˆØ· Ø§Ù„Ù…ÙƒØªÙˆØ¨Ø© Ù‚Ø¨Ù„ Ø§ØªØ®Ø§Ø° Ø£ÙŠ Ù‚Ø±Ø§Ø±. Ù‡Ù„ ØªÙØ¶Ù‘Ù„ Ø£Ù† Ù†Ø¨Ø¯Ø£ Ø¨Ù…Ø±Ø§Ø¬Ø¹Ø© Ø§Ù„ØªÙØ§ØµÙŠÙ„ Ø£Ù… ØªØ­Ø¯ÙŠØ¯ Ù…ÙˆØ¹Ø¯ØŸ",
        installment: "Ø£Ù‚Ø¯Ø± Ø£ÙˆØ¶Ø­ Ù„Ùƒ Ø®Ø·Ø© Ø§Ù„Ø³Ø¯Ø§Ø¯ Ø¨Ù†Ø¯Ù‹Ø§ Ø¨Ù†Ø¯Ù‹Ø§: Ø§Ù„Ù…Ù‚Ø¯Ù…ØŒ Ù‚ÙŠÙ…Ø© Ø§Ù„Ø£Ù‚Ø³Ø§Ø· ÙˆØªÙˆØ§ØªØ±Ù‡Ø§ØŒ Ù…Ø¯Ø© Ø§Ù„Ø³Ø¯Ø§Ø¯ØŒ ÙˆØ£ÙŠ Ø¯ÙØ¹Ø§Øª Ø¥Ø¶Ø§ÙÙŠØ© Ø­Ø³Ø¨ Ø§Ù„Ù…Ø³ØªÙ†Ø¯ Ø§Ù„Ù…Ø¹ØªÙ…Ø¯. Ù„Ù† Ø£ÙØªØ±Ø¶ Ø£Ø±Ù‚Ø§Ù…Ù‹Ø§ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø© ÙÙŠ Ø¹Ø±Ø¶ Ø§Ù„Ø³Ø¹Ø±.",
        location: "Ø®Ù„Ù‘ÙŠÙ†Ø§ Ù†Ø±Ø§Ø¬Ø¹ Ø§Ù„Ù…ÙˆÙ‚Ø¹ Ø¹Ù„Ù‰ Ø§Ù„Ø®Ø±ÙŠØ·Ø© ÙˆÙ†ØªØ­Ù‚Ù‚ Ù…Ù† Ø§Ù„Ù…Ø³Ø§ÙØ§Øª ÙˆØ§Ù„Ø·Ø±Ù‚ ÙˆØ§Ù„Ø®Ø¯Ù…Ø§Øª Ù…Ù† Ù…ØµØ§Ø¯Ø± ÙˆØ§Ø¶Ø­Ø©ØŒ Ø«Ù… Ù†Ù‚Ø§Ø±Ù†Ù‡Ø§ Ø¨Ø£ÙˆÙ„ÙˆÙŠØ§ØªÙƒ Ø§Ù„ÙŠÙˆÙ…ÙŠØ© Ø¨Ø¯Ù„ Ø§Ù„Ø§ÙƒØªÙØ§Ø¡ Ø¨ÙˆØµÙ Ø¹Ø§Ù….",
        investment: "Ù„Ùˆ Ø§Ù„Ù‡Ø¯Ù Ø§Ø³ØªØ«Ù…Ø§Ø±ÙŠØŒ Ù†Ø±Ø§Ø¬Ø¹ Ø§Ù„ØªÙƒÙ„ÙØ© Ø§Ù„ÙƒØ§Ù…Ù„Ø©ØŒ Ø§Ù„Ø±Ø³ÙˆÙ…ØŒ Ø§Ù„Ø³ÙŠÙˆÙ„Ø©ØŒ Ù…ÙˆØ¹Ø¯ Ø§Ù„ØªØ³Ù„ÙŠÙ…ØŒ ÙˆØ§Ù„Ø³ÙŠÙ†Ø§Ø±ÙŠÙˆÙ‡Ø§Øª Ø§Ù„Ù…Ø­ØªÙ…Ù„Ø©. Ù„Ø§ Ø£Ù‚Ø¯Ø± Ø£Ø¶Ù…Ù† Ø¹Ø§Ø¦Ø¯Ù‹Ø§Ø› Ø§Ù„Ù‚Ø±Ø§Ø± ÙŠÙƒÙˆÙ† Ø¨Ø¹Ø¯ ÙØ­Øµ Ø§Ù„Ø£Ø±Ù‚Ø§Ù… ÙˆØ§Ù„Ù…Ø®Ø§Ø·Ø±."
      };
      const stagePrompts = {
        first: "Ù…Ø§ Ø§Ù„Ø£ÙˆÙ„ÙˆÙŠØ© Ø§Ù„Ø£Ù‡Ù… Ø¨Ø§Ù„Ù†Ø³Ø¨Ø© Ù„Ùƒ ÙÙŠ Ù‡Ø°Ù‡ Ø§Ù„Ù…Ø±Ø­Ù„Ø©ØŸ",
        afterdetails: "Ù‡Ù„ ØªÙˆØ¯ Ø£Ù† Ø£Ø´Ø±Ø­ Ø¨Ù†Ø¯Ù‹Ø§ Ø¨Ø¹ÙŠÙ†Ù‡ ÙÙŠ Ø§Ù„ØªÙØ§ØµÙŠÙ„ Ø§Ù„ØªÙŠ ÙˆØµÙ„ØªÙƒØŸ",
        aftervisit: "Ù…Ø§ Ø£ÙƒØ«Ø± Ù†Ù‚Ø·Ø© Ù„ÙØªØª Ø§Ù†ØªØ¨Ø§Ù‡Ùƒ Ø£Ø«Ù†Ø§Ø¡ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©ØŒ ÙˆÙ…Ø§ Ø§Ù„Ø°ÙŠ ÙŠØ­ØªØ§Ø¬ Ù…Ø±Ø§Ø¬Ø¹Ø©ØŸ",
        decision: "Ø®Ø° ÙˆÙ‚ØªÙƒØŒ ÙˆÙŠÙ…ÙƒÙ†Ù†Ø§ Ù…Ø±Ø§Ø¬Ø¹Ø© Ø£ÙŠ Ø¨Ù†Ø¯ ØºÙŠØ± ÙˆØ§Ø¶Ø­ Ù‚Ø¨Ù„ Ø£Ù† ØªÙ‚Ø±Ø±."
      };
      const scenarioOpenings = {
        whatsapp: { professional: "Ø£Ù‡Ù„Ù‹Ø§ Ø¨Ø­Ø¶Ø±ØªÙƒØŒ", friendly: "Ø£Ù‡Ù„Ù‹Ø§ ÙˆØ³Ù‡Ù„Ù‹Ø§ ðŸ‘‹", concise: "Ø£Ù‡Ù„Ù‹Ø§ØŒ" },
        phone: { professional: "Ø£Ù‡Ù„Ù‹Ø§ Ø¨Ø­Ø¶Ø±ØªÙƒØŒ Ø®Ù„Ù‘ÙŠÙ†ÙŠ Ø£ÙˆØ¶Ø­ Ø§Ù„Ù†Ù‚Ø·Ø© Ø¨Ø§Ø®ØªØµØ§Ø±.", friendly: "Ø£Ù‡Ù„Ù‹Ø§ØŒ Ø³Ø¹ÙŠØ¯ Ø¨ØªÙˆØ§ØµÙ„Ùƒ.", concise: "Ø£Ù‡Ù„Ù‹Ø§ØŒ" },
        meeting: { professional: "ÙŠØ´Ø±ÙÙ†ÙŠ Ø£Ù† Ø£Ø±Ø§Ø¬Ø¹ Ù…Ø¹Ùƒ Ø§Ù„ØªÙØ§ØµÙŠÙ„.", friendly: "Ø³Ø¹ÙŠØ¯ Ø¨ÙˆØ¬ÙˆØ¯ÙƒØŒ Ø®Ù„Ù‘ÙŠÙ†Ø§ Ù†Ø±Ø§Ø¬Ø¹Ù‡Ø§ Ø³ÙˆØ§.", concise: "Ø®Ù„Ù‘ÙŠÙ†Ø§ Ù†Ø±Ø§Ø¬Ø¹ Ø§Ù„ØªÙØ§ØµÙŠÙ„." },
        email: { professional: "ØªØ­ÙŠØ© Ø·ÙŠØ¨Ø©ØŒ", friendly: "Ø£Ù‡Ù„Ù‹Ø§ ÙˆØ³Ù‡Ù„Ù‹Ø§ØŒ", concise: "Ù…Ø±Ø­Ø¨Ù‹Ø§ØŒ" }
      };
      const scenarioClosings = {
        professional: "Ø£Ù†Ø§ Ù…ØªØ§Ø­ Ù„Ù„Ø¥Ø¬Ø§Ø¨Ø© Ø¹Ù† Ø£Ø³Ø¦Ù„ØªÙƒØŒ ÙˆØ§Ù„Ù…Ø¹Ù„ÙˆÙ…Ø§Øª Ø§Ù„Ù†Ù‡Ø§Ø¦ÙŠØ© Ù†Ø«Ø¨ØªÙ‡Ø§ Ù…Ù† Ø§Ù„Ù…Ø³ØªÙ†Ø¯Ø§Øª Ø§Ù„Ø±Ø³Ù…ÙŠØ©.",
        friendly: "Ù‚ÙˆÙ„ Ù„ÙŠ Ø¥ÙŠÙ‡ Ø§Ù„Ø£Ù†Ø³Ø¨ Ù„Ùƒ ÙˆØ£Ù†Ø§ Ø£Ø±ØªØ¨ Ù„Ùƒ Ø§Ù„Ø®Ø·ÙˆØ© Ø§Ù„Ø¬Ø§ÙŠØ© Ø¨ÙƒÙ„ ÙˆØ¶ÙˆØ­.",
        concise: "Ù…Ø§ Ø§Ù„ÙˆÙ‚Øª Ø§Ù„Ù…Ù†Ø§Ø³Ø¨ Ù„Ù„Ù…ØªØ§Ø¨Ø¹Ø©ØŸ"
      };
      function renderSmartReply() {
        const topic = byId("scenario-topic").value;
        const buyer = byId("scenario-buyer").value;
        const region = byId("scenario-region").value;
        const channel = byId("scenario-channel").value;
        const stage = byId("scenario-stage").value;
        const tone = byId("scenario-tone").value;
        const facts = byId("scenario-project-facts").value.trim();
        const lines = [
          scenarioOpenings[channel][tone],
          `Ø¨Ø§Ù„Ù†Ø³Ø¨Ø© Ø¥Ù„Ù‰ ${scenarioDimensions.buyer[buyer]} ÙÙŠ ${scenarioDimensions.region[region]}ØŒ ${scenarioTopics[topic]}`,
          stagePrompts[stage],
          facts ? `Ù…Ø¹Ù„ÙˆÙ…Ø© Ù…Ø¤ÙƒØ¯Ø© Ù…Ù†Ùƒ: ${facts}` : "",
          scenarioClosings[tone]
        ].filter(Boolean);
        byId("scenario-result").value = lines.join("\n\n");
        byId("script-scenario-count").textContent = `${integer.format(smartReplyCount)} Ø³ÙŠØ§Ù‚Ù‹Ø§`;
      }
      document.querySelectorAll("#panel-scripts [id^='scenario-']").forEach(input => {
        input.addEventListener("change", renderSmartReply);
        input.addEventListener("input", renderSmartReply);
      });
      byId("copy-scenario").addEventListener("click", async () => {
        const text = byId("scenario-result").value;
        try {
          if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
          await navigator.clipboard.writeText(text);
          showToast("ØªÙ… Ù†Ø³Ø® Ø§Ù„Ø±Ø¯ Ø§Ù„Ù…Ù‚ØªØ±Ø­.");
        } catch (error) {
          console.error("Smart reply clipboard write failed:", error);
          const helper = document.createElement("textarea");
          helper.value = text;
          helper.style.position = "fixed";
          helper.style.opacity = "0";
          document.body.appendChild(helper);
          helper.select();
          const copied = document.execCommand("copy");
          helper.remove();
          showToast(copied ? "ØªÙ… Ù†Ø³Ø® Ø§Ù„Ø±Ø¯ Ø§Ù„Ù…Ù‚ØªØ±Ø­." : "ØªØ¹Ø°Ø± Ø§Ù„Ù†Ø³Ø®Ø› Ø­Ø¯Ù‘Ø¯ Ø§Ù„Ù†Øµ ÙˆØ§Ù†Ø³Ø®Ù‡ ÙŠØ¯ÙˆÙŠÙ‹Ø§.");
        }
      });
      function renderScripts() {
        const query = scriptFilterWords("script-search");
        const scripts = [...defaultScripts, ...appState.customScripts].filter(item =>
          `${item.title} ${item.category} ${item.text}`.toLocaleLowerCase().includes(query)
        );
        byId("script-list").innerHTML = scripts.map(item => `<article class="script-item">
          <div class="script-item-head"><div><div class="script-title">${escapeHTML(item.title)}</div><div class="script-category">${escapeHTML(item.category)}${item.custom ? " Â· Ø®Ø§Øµ" : " Â· MJK"}</div></div><div class="btn-row"><button class="btn btn-secondary small-btn" type="button" data-copy-script="${escapeHTML(item.id)}">Ù†Ø³Ø® Ø§Ù„Ø±Ø¯</button>${item.custom ? `<button class="btn btn-danger small-btn" type="button" data-delete-script="${escapeHTML(item.id)}">Ø­Ø°Ù</button>` : ""}</div></div>
          <div class="script-body">${escapeHTML(item.text)}</div>
        </article>`).join("");
        byId("script-empty").hidden = scripts.length > 0;
      }
      byId("script-form").addEventListener("submit", event => {
        event.preventDefault();
        if (!event.currentTarget.reportValidity()) return;
        const script = {
          id: makeId("script"), title: byId("script-title-input").value.trim(),
          category: byId("script-category-input").value, text: byId("script-body-input").value.trim(),
          custom: true, createdAt: new Date().toISOString()
        };
        appState.customScripts.unshift(script);
        if (!persistAppState()) { appState.customScripts = appState.customScripts.filter(item => item.id !== script.id); return; }
        event.currentTarget.reset();
        renderScripts();
        showToast("ØªÙ… Ø­ÙØ¸ Ø§Ù„Ø³ÙƒØ±ÙŠØ¨Øª ÙÙŠ Ù…ÙƒØªØ¨ØªÙƒ.");
      });
      byId("script-search").addEventListener("input", renderScripts);
      byId("script-list").addEventListener("click", async event => {
        const copyButton = event.target.closest("[data-copy-script]");
        const deleteButton = event.target.closest("[data-delete-script]");
        if (deleteButton) {
          appState.customScripts = appState.customScripts.filter(item => item.id !== deleteButton.dataset.deleteScript);
          persistAppState();
          renderScripts();
          showToast("ØªÙ… Ø­Ø°Ù Ø§Ù„Ø³ÙƒØ±ÙŠØ¨Øª Ø§Ù„Ø®Ø§Øµ.");
          return;
        }
        if (!copyButton) return;
        const script = [...defaultScripts, ...appState.customScripts].find(item => item.id === copyButton.dataset.copyScript);
        if (!script) return;
        try {
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(script.text);
          else throw new Error("Clipboard API unavailable");
          showToast("ØªÙ… Ù†Ø³Ø® Ø§Ù„Ø³ÙƒØ±ÙŠØ¨Øª.");
        } catch (error) {
          console.error("Clipboard write failed:", error);
          const helper = document.createElement("textarea");
          helper.value = script.text;
          helper.style.position = "fixed";
          helper.style.opacity = "0";
          document.body.appendChild(helper);
          helper.select();
          const copied = document.execCommand("copy");
          helper.remove();
          showToast(copied ? "ØªÙ… Ù†Ø³Ø® Ø§Ù„Ø³ÙƒØ±ÙŠØ¨Øª." : "ØªØ¹Ø°Ø± Ø§Ù„Ù†Ø³Ø®Ø› Ø­Ø¯Ù‘Ø¯ Ø§Ù„Ù†Øµ ÙˆØ§Ù†Ø³Ø®Ù‡ ÙŠØ¯ÙˆÙŠÙ‹Ø§.");
        }
      });

      function renderAnalytics() {
        if (!byId("analytics-leads")) return;
        const expected = leads.reduce((sum, lead) => sum + (lead.status === "lost" ? 0 : Math.max(0, Number(lead.expectedCommission) || 0)), 0);
        const openAppointments = appState.appointments.filter(item => !item.done);
        byId("analytics-leads").textContent = integer.format(leads.length);
        byId("analytics-hot").textContent = integer.format(leads.filter(lead => lead.interest === "hot").length);
        byId("analytics-commission").textContent = formatMoney(expected);
        byId("analytics-batches").textContent = integer.format(appState.cleanerBatchRuns);
        byId("analytics-appointments").textContent = integer.format(openAppointments.length);
        byId("analytics-lookups").textContent = integer.format(appState.lookups.length);
        byId("analytics-archive").textContent = integer.format(appState.archive.length);
        byId("analytics-no-followup").textContent = integer.format(leads.filter(lead => !lead.date && lead.status !== "won" && lead.status !== "lost").length);
        const entries = Object.entries(leadStatuses);
        const maxValue = Math.max(1, ...entries.map(([status]) => leads.filter(lead => (lead.status || "new") === status).length));
        byId("status-chart").innerHTML = entries.map(([status, label]) => {
          const count = leads.filter(lead => (lead.status || "new") === status).length;
          const height = Math.max(4, count / maxValue * 128);
          return `<div class="chart-column"><span class="chart-value">${integer.format(count)}</span><span class="chart-bar" style="height:${height}px" title="${escapeHTML(label)}: ${count}"></span><span class="chart-label">${escapeHTML(label)}</span></div>`;
        }).join("");
        byId("analytics-updated").textContent = `ØªØ­Ø¯ÙŠØ« ${new Intl.DateTimeFormat("ar-EG", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
      }

      byId("property-price").addEventListener("input", renderAnalytics);
      renderCompanyModules();
      renderLeads();
      renderLookup();
      populateAppointmentClients();
      byId("appointment-date").value = localDateInput();
      renderAppointments();
      renderArchive();
      renderScripts();
      renderAnalytics();
      initializeCloudSync().catch(error => {
        console.error("Could not initialize Firebase cloud sync:", error);
        setCloudStatus("ØªØ¹Ø°Ø± ØªÙ‡ÙŠØ¦Ø© Firebase", "error");
        byId("cloud-account-status").textContent = `ØªØ¹Ø°Ø± ØªÙ‡ÙŠØ¦Ø© Firebase: ${error.message || error.code}.`;
      });
      if (appState.cleanerPreferences) {
        byId("batch-size").value = String(clamp(Number(appState.cleanerPreferences.batchSize) || 50, 1, 500));
        if ([...byId("phone-region").options].some(option => option.value === appState.cleanerPreferences.region)) {
          byId("phone-region").value = appState.cleanerPreferences.region;
        }
      }
      if (typeof appState.rawContacts === "string") {
        byId("raw-contacts").value = appState.rawContacts ||
          appState.cleanerRows.map(record => `${record.name || ""}, ${record.phone || ""}`).join("\n");
        if (byId("raw-contacts").value.trim()) runCleaner(false, false);
      }
    })();