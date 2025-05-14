document.addEventListener('DOMContentLoaded', () => {
    // --- عناصر الواجهة (اختصارات) ---
    const getEl = (id) => document.getElementById(id);
    const screens = {
        welcome: getEl('welcomeScreen'),
        operation: getEl('operationScreen'),
        history: getEl('historyScreen'),
    };
    const formSteps = Array.from(screens.operation.querySelectorAll('.form-step'));

    // --- حالة التطبيق ومعرّفات localStorage ---
    const HISTORY_KEY = 'smartWarehouseHistory_v5';
    const INVENTORY_KEY = 'smartWarehouseInventory_v5';
    const CONFIG_KEY = 'smartWarehouseConfig_v5'; // مفتاح إعدادات التطبيق
    const CUSTOMERS_KEY = 'smartWarehouseCustomers_v5';
    const DEFAULT_PASSWORD = "0000";

    // --- الطاقة الاستيعابية للمخزن (حسب الطلب) ---
    const MAX_STOCK_PER_TYPE = 4; // الحد الأقصى للمخزون لكل نوع
    const MAX_TOTAL_OUTPUT = 16; // الحد الأقصى الإجمالي للأصناف في عملية إخراج واحدة
    const TOTAL_MAX_INVENTORY = 16; // الحد الأقصى الإجمالي للمخزون في المستودع

    let currentStep = 1;
    let currentOperationType = null;
    let currentOperationData = {}; // { customer: { name, phone }, items: [{ type: 'A', quantity: 1 }] }
    let currentScannedItems = []; // Items scanned in the current input operation: [{ type: 'A', timestamp: '...' }]
    let operationsHistory = []; // [{ id: 1, type: 'input', customer: { name, phone }, timestamp: '...', items: { A: 1, B: 0, C: 0, D: 0 }, detailedLog: [...] }]
    let inventory = { A: 0, B: 0, C: 0, D: 0 };
    let config = { password: DEFAULT_PASSWORD, scanDelay: 10, lastOpNumber: 0 };
    let customers = {}; // { "Name": { phone, lastActivity, operationCount } }
    let isScanningPaused = false;
    let scanPauseTimeoutId = null;
    let scanPauseIntervalId = null;

    const CONNECTION_SETTINGS_KEY = 'smartWarehouseConnectionSettings_v5';
    let connectionSettings = {
        ip: "192.168.137.69",
        port: "80"
    };
    let ESP_BASE_URL = `http://${connectionSettings.ip}${connectionSettings.port ? ':' + connectionSettings.port : ''}`;

    const EMAILJS_SERVICE_ID = 'service_ptc40fc';
    const EMAILJS_TEMPLATE_ID = 'template_f21l5z9';
    const EMAILJS_PUBLIC_KEY = 'TYqL6xQ0KqARmmmfE';

    const passwordOverlay = getEl('passwordPromptOverlay');
    const passwordInput = getEl('passwordInput');
    const submitPasswordBtn = getEl('submitPasswordBtn');
    const passwordError = getEl('passwordError');
    const backToWelcomeFromPwd = getEl('backToWelcomeFromPwd');
    let passwordResolve = null;

    const validationErrorElements = {
        actionType: getEl('actionTypeError'),
        output: getEl('outputError'),
        customerName: getEl('customerNameError')
    };

    // دالة لتحميل إعدادات التطبيق (كلمة المرور، تأخير المسح، رقم آخر عملية)
    function loadConfig() {
        console.log("Loading app config...");
        try {
            const storedConfig = localStorage.getItem(CONFIG_KEY);
            if (storedConfig) {
                const parsedConfig = JSON.parse(storedConfig);
                config = {
                    password: parsedConfig.password ? String(parsedConfig.password) : DEFAULT_PASSWORD,
                    scanDelay: typeof parsedConfig.scanDelay === 'number' ? parsedConfig.scanDelay : 10,
                    lastOpNumber: typeof parsedConfig.lastOpNumber === 'number' ? parsedConfig.lastOpNumber : 0
                };
                console.log("App config loaded:", config);
            } else {
                 saveConfig();
                 console.log("No app config in localStorage, saving default.", config);
            }
        } catch (e) {
            console.error("Error loading app config:", e);
             config = { password: DEFAULT_PASSWORD, scanDelay: 10, lastOpNumber: 0 };
             saveConfig();
             console.log("App config load failed, resetting to default.", config);
        }
    }

    // دالة لحفظ إعدادات التطبيق
    function saveConfig() {
        try {
            localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
            console.log("App config saved to localStorage.", config);
            return true;
        } catch (e) {
            console.error("Error saving app config:", e);
            return false;
        }
    }

    // دالة لتحميل إعدادات الاتصال
    function loadConnectionSettings() {
        console.log("Loading connection settings...");
        try {
            const storedSettings = localStorage.getItem(CONNECTION_SETTINGS_KEY);
            if (storedSettings) {
                const parsedSettings = JSON.parse(storedSettings);
                connectionSettings = {
                    ip: parsedSettings.ip ? String(parsedSettings.ip) : "192.168.137.69",
                    port: parsedSettings.port ? String(parsedSettings.port) : "80"
                };
                ESP_BASE_URL = `http://${connectionSettings.ip}${connectionSettings.port ? ':' + connectionSettings.port : ''}`;
                console.log("Connection settings loaded:", connectionSettings);
            } else {
                 connectionSettings = { ip: "192.168.137.69", port: "80" };
                 saveConnectionSettings();
                 ESP_BASE_URL = `http://${connectionSettings.ip}${connectionSettings.port ? ':' + connectionSettings.port : ''}`;
                 console.log("No connection settings in localStorage, saving default.", connectionSettings);
            }
        } catch (e) {
            console.error("Error loading connection settings:", e);
             connectionSettings = { ip: "192.168.137.69", port: "80" }; // Corrected default IP
             saveConnectionSettings();
             ESP_BASE_URL = `http://${connectionSettings.ip}${connectionSettings.port ? ':' + connectionSettings.port : ''}`;
             console.log("Connection settings load failed, resetting to default.", connectionSettings);
        }
    }

    // دالة لحفظ إعدادات الاتصال
    function saveConnectionSettings() {
        try {
            localStorage.setItem(CONNECTION_SETTINGS_KEY, JSON.stringify(connectionSettings));
            ESP_BASE_URL = `http://${connectionSettings.ip}${connectionSettings.port ? ':' + connectionSettings.port : ''}`;
            console.log("Connection settings saved to localStorage.", connectionSettings);
            return true;
        } catch (e) {
            console.error("Error saving connection settings:", e);
            return false;
        }
    }

    // دالة للتحقق من صحة عنوان IP
    function isValidIp(ip) {
        const ipPattern = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        return ipPattern.test(ip);
    }

    // دالة للتحقق من صحة المنفذ
    function isValidPort(port) {
        if (!port) return true; // المنفذ اختياري
        const portNum = parseInt(port);
        return !isNaN(portNum) && portNum > 0 && portNum <= 65535;
    }

    // دالة لحفظ المخزون
    function saveInventory() {
        try {
            localStorage.setItem(INVENTORY_KEY, JSON.stringify(inventory));
            console.log("Inventory saved to localStorage.", inventory);
            updateInventorySummary(); // تحديث الملخص بعد الحفظ
            return true;
        } catch (e) {
            console.error("Error saving inventory:", e);
            return false;
        }
    }

    // *** دالة تحميل المخزون (تمت إضافتها هنا) ***
    function loadInventory() {
        console.log("Loading inventory...");
        try {
            const storedInventory = localStorage.getItem(INVENTORY_KEY);
            if (storedInventory) {
                const parsedInventory = JSON.parse(storedInventory);
                // التحقق من أن البيانات المحملة تحتوي على المفاتيح المتوقعة
                inventory = {
                    A: parsedInventory.A || 0,
                    B: parsedInventory.B || 0,
                    C: parsedInventory.C || 0,
                    D: parsedInventory.D || 0
                };
                console.log("Inventory loaded from localStorage:", inventory);
            } else {
                // إذا لم يكن هناك مخزون في localStorage، احفظ المخزون الافتراضي (فارغ)
                inventory = { A: 0, B: 0, C: 0, D: 0 }; // التأكد من إعادة التعيين إلى الافتراضي
                saveInventory(); // هذا سيقوم أيضًا بتحديث الملخص
                console.log("No inventory in localStorage, initialized to default and saved.", inventory);
            }
        } catch (e) {
            console.error("Error loading inventory:", e);
            // إعادة التعيين إلى الافتراضي إذا فشل التحميل
            inventory = { A: 0, B: 0, C: 0, D: 0 };
            saveInventory(); // محاولة حفظ الافتراضي
            console.log("Inventory load failed, resetting to default and saved.", inventory);
        }
        // التأكد من تحديث الملخص بعد التحميل، بغض النظر عن المصدر
        updateInventorySummary();
    }


    // دالة تحميل الزبائن
    function loadCustomers() {
        console.log("Loading customers...");
        try {
            const storedCustomers = localStorage.getItem(CUSTOMERS_KEY);
            if (storedCustomers) {
                customers = JSON.parse(storedCustomers);
                if (typeof customers !== 'object' || customers === null) {
                     console.warn("Stored customers was not an object, resetting.");
                     customers = {};
                }
                console.log("Customers loaded from localStorage:", customers);
            } else {
                customers = {};
                console.log("No customers in localStorage, initialized to empty object.");
            }
        } catch (e) {
            console.error("Error loading customers:", e);
            customers = {};
            console.log("Customers load failed, reset to empty object.");
        }
    }

    // دالة حفظ الزبائن
    function saveCustomers() {
        try {
            localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customers));
            console.log("Customers saved to localStorage.", customers);
            return true;
        } catch (e) {
            console.error("Error saving customers:", e);
            return false;
        }
    }


    // دالة تحميل السجل
    function loadHistory() {
        console.log("Loading history...");
        try {
            const storedHistory = localStorage.getItem(HISTORY_KEY);
            if (storedHistory) {
                operationsHistory = JSON.parse(storedHistory);
                if (!Array.isArray(operationsHistory)) {
                    console.warn("Stored history was not an array, resetting.");
                    operationsHistory = [];
                }
                console.log("History loaded from localStorage. Entries:", operationsHistory.length);
            } else {
                operationsHistory = [];
                console.log("No history in localStorage, initialized to empty array.");
            }
        } catch (e) {
            console.error("Error loading history:", e);
            operationsHistory = [];
            console.log("History load failed, reset to empty array.");
        }
    }

    // دالة حفظ السجل
    function saveHistory() {
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(operationsHistory));
            console.log("History saved to localStorage. Entries:", operationsHistory.length);
            return true;
        } catch (e) {
            console.error("Error saving history:", e);
            return false;
        }
    }
    
    // دالة لتحديث ملخص المخزون في شاشة الترحيب وفي نموذج الإخراج
    function updateInventorySummary() {
        console.log("Updating inventory summary on welcome screen...");
        const invSummaryA = getEl('invSummaryA');
        const invSummaryB = getEl('invSummaryB');
        const invSummaryC = getEl('invSummaryC');
        const invSummaryD = getEl('invSummaryD');

        if (invSummaryA) invSummaryA.textContent = inventory.A || 0; else console.warn("#invSummaryA not found.");
        if (invSummaryB) invSummaryB.textContent = inventory.B || 0; else console.warn("#invSummaryB not found.");
        if (invSummaryC) invSummaryC.textContent = inventory.C || 0; else console.warn("#invSummaryC not found.");
        if (invSummaryD) invSummaryD.textContent = inventory.D || 0; else console.warn("#invSummaryD not found.");
        
        displayInventoryInForm(); // تحديث المخزون في نموذج الإخراج أيضًا
        console.log("Inventory summary updated with values:", inventory);
    }

    // دالة لعرض المخزون الحالي في نموذج الإخراج
    function displayInventoryInForm() {
        console.log("Displaying inventory in output form...");
        const stockA = getEl('stockA');
        const stockB = getEl('stockB');
        const stockC = getEl('stockC');
        const stockD = getEl('stockD');

        if (stockA) stockA.textContent = inventory.A || 0; else console.warn("#stockA not found in output form.");
        if (stockB) stockB.textContent = inventory.B || 0; else console.warn("#stockB not found in output form.");
        if (stockC) stockC.textContent = inventory.C || 0; else console.warn("#stockC not found in output form.");
        if (stockD) stockD.textContent = inventory.D || 0; else console.warn("#stockD not found in output form.");
        console.log("Inventory displayed in output form with values:", inventory);
    }


    // --- التهيئة الأولية ---
    function initializeApp() {
        console.log("Initializing App...");
        loadConfig();
        loadConnectionSettings();
        loadInventory(); // سيقوم هذا أيضًا باستدعاء updateInventorySummary
        loadCustomers();
        loadHistory();
        // updateInventorySummary(); // تم الإزالة - يتم استدعاؤه بواسطة loadInventory
        setupEventListeners();
        showScreen(screens.welcome);

         if (EMAILJS_PUBLIC_KEY && EMAILJS_PUBLIC_KEY !== 'YOUR_EMAILJS_PUBLIC_KEY') {
              console.log("Initializing EmailJS...");
             emailjs.init(EMAILJS_PUBLIC_KEY);
         } else {
              console.warn("EmailJS Public Key is not set. Email notifications will not work.");
         }
         checkForLowStock();
         console.log("App initialization finished.");
    }


    // --- إدارة الشاشات والخطوات ---
    function showScreen(screenToShow) {
        Object.values(screens).forEach(s => {
            if (s) s.classList.remove('active');
        });
        if (screenToShow) {
            screenToShow.classList.add('active');
            console.log(`Showing screen: ${screenToShow.id}`);
            if (screenToShow === screens.welcome) {
                updateInventorySummary();
                 hideStatus(getEl('generalStatus'));
            } else {
                 hideStatus(getEl('generalStatus'));
            }
             window.scrollTo(0, 0);
        } else {
             console.error("Attempted to show a null screen.");
        }
    }

    function showStep(stepNumber) {
        console.log(`Attempting to show step: ${stepNumber}`);
        formSteps.forEach(step => step.classList.remove('active-step'));

        let stepToShow = formSteps.find(step => {
            const stepNum = parseInt(step.dataset.step);
            const stepType = step.dataset.type;
            if (stepNum !== stepNumber) return false;
            if (stepType && stepType !== currentOperationType) return false;
            if (!stepType && stepNumber !== 1) return false;
            return true;
        });

        if (stepToShow) {
            stepToShow.classList.add('active-step');
            currentStep = stepNumber;
            console.log(`Showing form step: ${stepNumber} (Type: ${currentOperationType || 'None'})`);

            if (stepNumber === 1) {
                const opNumDisplay = getEl('operationNumberDisplay');
                if(opNumDisplay) opNumDisplay.value = config.lastOpNumber + 1;
                else console.warn("#operationNumberDisplay not found.");
                displayCustomerList();
                 hideStatus(getEl('actionTypeError'));
                 const customerNameErrorEl = getEl('customerNameError');
                 if(customerNameErrorEl) customerNameErrorEl.textContent = '';
                const radioLabels = screens.operation.querySelectorAll('.radio-group-horizontal label');
                radioLabels.forEach(label => label.classList.remove('selected'));
                const actionTypeRadios = document.querySelectorAll('input[name="actionType"]');
                 actionTypeRadios.forEach(radio => radio.checked = false);
            }
            if (stepNumber === 2 && currentOperationType === 'input') {
                const qrInput = getEl('qrInput');
                 if(qrInput) {
                     qrInput.value = '';
                     qrInput.disabled = false;
                     qrInput.focus();
                 } else {
                      console.error("#qrInput not found for input step.");
                 }
                 isScanningPaused = false;
                 clearTimeout(scanPauseTimeoutId);
                 clearInterval(scanPauseIntervalId);
                 updateScannedItemsDisplay();
                 hideStatus(getEl('scanStatus'));
            }
            if (stepNumber === 2 && currentOperationType === 'output') {
                 displayInventoryInForm();
                 resetOutputQuantities();
                 hideStatus(getEl('outputError'));
                 loadAndDisplayLastInputInfo();
                  const sendOutputBtn = getEl('sendOutputBtn');
                 if(sendOutputBtn) {
                      sendOutputBtn.disabled = false;
                      sendOutputBtn.innerHTML = '<i class="fas fa-paper-plane icon"></i> إرسال الطلب للروبوت';
                 } else {
                      console.error("#sendOutputBtn not found for output step.");
                 }
                 const qInputs = getQuantityInputs();
                 for(const type in qInputs) {
                     if(qInputs[type]) {
                         qInputs[type].removeEventListener('input', updateTotalRequested);
                         qInputs[type].addEventListener('input', updateTotalRequested);
                     }
                 }
                 updateTotalRequested();
            }
        } else {
            console.error("Step element not found for step:", stepNumber, "type:", currentOperationType);
            showScreen(screens.welcome);
        }
    }

    // --- وظائف مساعدة للعناصر ---
    function showElement(element, displayType = 'block') {
         if (element) element.style.display = displayType;
    }

    function hideElement(element) {
         if (element) element.style.display = 'none';
    }

    function showStatus(element, message, type = 'info') {
        if (element) {
            element.textContent = message;
            element.className = 'status-message small'; // Reset classes first
            element.classList.add(type); // Add type class
            element.style.display = 'block'; // Make visible
            console.log(`Status on ${element.id || 'element'}: ${message} (${type})`);
        } else {
            console.warn(`Attempted to show status on non-existent element with message: "${message}"`);
        }
    }
    
    function hideStatus(element) {
        if (element) {
             element.style.display = 'none';
             console.log(`Status on ${element.id || 'element'} hidden.`);
        }
    }

    function resetCurrentOperation() {
        console.log("Resetting current operation...");
        currentStep = 1;
        currentOperationType = null;
        currentOperationData = {};
        currentScannedItems = [];

        const operationFormEl = getEl('operationForm');
        if (operationFormEl) operationFormEl.reset();

        const actionTypeErrorEl = getEl('actionTypeError');
        const outputErrorEl = getEl('outputError');
        const customerNameErrorEl = getEl('customerNameError');
        if(actionTypeErrorEl) actionTypeErrorEl.textContent = '';
        if(outputErrorEl) outputErrorEl.textContent = '';
        if(customerNameErrorEl) customerNameErrorEl.textContent = '';

        hideStatus(getEl('scanStatus'));
        hideStatus(getEl('outputSendStatus'));
        hideStatus(getEl('generalStatus'));

         const customerNameInput = getEl('customerName');
         if(customerNameInput) customerNameInput.style.borderColor = '';
         resetOutputQuantities();
         updateScannedItemsDisplay();

        formSteps.forEach(step => step.classList.remove('active-step'));
        const firstStep = formSteps.find(step => parseInt(step.dataset.step) === 1);
        if(firstStep) firstStep.classList.add('active-step');

        const radioLabels = screens.operation.querySelectorAll('.radio-group-horizontal label');
        radioLabels.forEach(label => label.classList.remove('selected'));
        const actionTypeRadios = document.querySelectorAll('input[name="actionType"]');
         actionTypeRadios.forEach(radio => radio.checked = false);
        console.log("Current operation reset complete.");
    }

    function generateUniqueId() {
        return `op_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }

    // --- وظائف كلمة المرور ---
    function promptForPasswordModal(message = "الرجاء إدخال كلمة المرور:") {
        console.log("Attempting to show password modal...");
        if (!passwordOverlay || !passwordInput || !submitPasswordBtn || !backToWelcomeFromPwd || !passwordError) {
             console.error("Password modal elements not found! Cannot display password prompt.");
             alert("حدث خطأ في عرض نافذة كلمة المرور.");
             return Promise.resolve(null);
        }
        return new Promise((resolve) => {
            passwordResolve = resolve;
            const messageElement = passwordOverlay.querySelector('p');
             if(messageElement) messageElement.textContent = message;
             else console.warn("Password modal message element not found.");
            passwordInput.value = '';
            if(passwordError) passwordError.textContent = '';
             else console.warn("Password error element not found.");
            passwordOverlay.classList.add('active');
            passwordInput.focus();
            console.log("Password modal displayed. Waiting for user input.");
        });
    }

    function closePasswordPrompt(value) {
        console.log(`Closing password modal with value: ${value === null ? 'null (cancelled)' : 'password provided'}`);
        if (passwordOverlay) passwordOverlay.classList.remove('active');
        else console.warn("Password overlay element not found during close.");
        if (passwordResolve) {
            passwordResolve(value);
            passwordResolve = null;
            console.log("Password promise resolved.");
        } else {
            console.warn("Password modal closed, but no active promise to resolve.");
        }
    }

    function checkPassword(enteredPassword) {
         const storedPassword = config.password;
         const isCorrect = enteredPassword === storedPassword;
         console.log(`Checking password: Entered="${enteredPassword}", Stored="${storedPassword}", Match=${isCorrect}`);
         if(passwordError) {
             if (!isCorrect) {
                 passwordError.textContent = "كلمة المرور غير صحيحة";
                 console.log("Password check failed, showing error on modal.");
             } else {
                 passwordError.textContent = "";
                 console.log("Password check successful, clearing modal error.");
             }
         } else {
             console.warn("Password error element not found during check.");
         }
         return isCorrect;
    }

    function savePassword(newPassword) {
        config.password = newPassword;
        if (saveConfig()) {
            alert("تم تغيير كلمة المرور بنجاح!");
            console.log("Password changed and config saved.");
        } else {
            alert("فشل حفظ كلمة المرور الجديدة.");
            console.error("Failed to save new password.");
        }
    }

    async function handleChangePassword() {
         console.log("Change password initiated.");
         if (!passwordOverlay || !passwordInput || !submitPasswordBtn || !backToWelcomeFromPwd || !passwordError) {
             alert("لا يمكن تغيير كلمة المرور، عناصر الواجهة غير موجودة.");
             console.error("Missing password modal elements for change password.");
             return;
         }
        const oldPassword = await promptForPasswordModal("لتغيير كلمة المرور، أدخل كلمة المرور الحالية:");
        if (oldPassword === null) {
            console.log("Change password cancelled at old password prompt.");
            return;
        }
        if (!checkPassword(oldPassword)) {
            console.warn("Incorrect old password provided for change.");
            return;
        }
         console.log("Old password correct.");
         closePasswordPrompt(true);
        const newPassword = await promptForPasswordModal("أدخل كلمة المرور الجديدة:");
        if (newPassword === null) {
             console.log("Change password cancelled at new password prompt.");
             return;
        }
        if (newPassword.trim() === "") {
            alert("كلمة المرور الجديدة لا يمكن أن تكون فارغة.");
            console.warn("New password cannot be empty.");
            return;
        }
        const confirmPassword = await promptForPasswordModal("أعد إدخال كلمة المرور الجديدة للتأكيد:");
        if (confirmPassword === null) {
             console.log("Change password cancelled at confirm password prompt.");
             return;
        }
        if (newPassword === confirmPassword) {
            savePassword(newPassword);
             console.log("New password confirmed and saved.");
        } else {
            alert("كلمتا المرور الجديدتان غير متطابقتين.");
            console.warn("New passwords do not match.");
        }
    }

    async function handleDeleteHistory() {
         console.log("Delete history initiated.");
         if (!passwordOverlay || !passwordInput || !submitPasswordBtn || !backToWelcomeFromPwd || !passwordError) {
             alert("لا يمكن حذف السجل، عناصر الواجهة غير موجودة.");
             console.error("Missing password modal elements for delete history.");
             return;
         }
         if (confirm("تحذير: هل أنت متأكد من حذف جميع السجلات؟ لا يمكن التراجع.")) {
             const enteredPassword = await promptForPasswordModal("لحذف السجل، أدخل كلمة المرور:");
             if (enteredPassword === null) {
                  console.log("Delete history cancelled at password prompt.");
                  return;
             }
             if (checkPassword(enteredPassword)) {
                 console.log("Password correct. Deleting history.");
                 closePasswordPrompt(true);
                 operationsHistory = [];
                 customers = {};
                 config.lastOpNumber = 0;
                 saveHistory();
                 saveCustomers();
                 saveConfig();
                 displayHistory();
                 alert("تم حذف جميع السجلات بنجاح.");
                 console.log("History deleted successfully.");
                 const historyContentEl = getEl('historyContent');
                 if(historyContentEl) historyContentEl.style.display = 'none';
                  else console.warn("#historyContent not found after deletion.");
                 showScreen(screens.welcome);
             } else {
                 console.warn("Incorrect password provided for delete history.");
             }
         } else {
             console.log("Delete history cancelled by user confirmation.");
         }
    }

    // --- وظيفة الإرسال للـ ESP ---
    async function sendDataToESP(data, type) {
        let endpoint = ESP_BASE_URL;
        let body = null;
        let headers = {};
        let statusElement = getEl('robotCommandStatus');

        if (type === 'input') {
            endpoint += '/input';
            body = String(data);
            headers = {'Content-Type':'text/plain'};
            statusElement = getEl('scanStatus');
        } else if (type === 'output') {
            endpoint += '/output';
            body = JSON.stringify(data);
            headers = {'Content-Type':'application/json'};
            statusElement = getEl('outputSendStatus');
        } else if (type === 'command') {
            endpoint += '/command';
            body = String(data);
            headers = {'Content-Type':'text/plain'};
            statusElement = getEl('robotCommandStatus');
        } else {
            console.error("Unknown type for ESP send:", type);
            if(statusElement) showStatus(statusElement, "خطأ داخلي: نوع أمر غير معروف.", 'error');
            return false;
        }

        console.log(`Sending ${type} to ${endpoint}:`, body);
        if(statusElement) showStatus(statusElement, `جاري إرسال الأمر...`, 'info');
        else console.warn("Status element not found for sendDataToESP.");

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                 controller.abort();
                 console.warn("ESP request timed out.");
            }, 15000);

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: headers,
                body: body,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.ok) {
                const responseText = await response.text();
                console.log("Response from ESP:", responseText);
                if (responseText.trim().toUpperCase().includes("OK")) {
                    console.log("ESP confirmation 'OK' received.");
                    if(statusElement) showStatus(statusElement, `تم الاستلام من الروبوت بنجاح.`, 'success');
                    if (type !== 'command') {
                        setTimeout(() => hideStatus(statusElement), 3000);
                    } else {
                         setTimeout(() => hideStatus(statusElement), 1500);
                    }
                    return true;
                } else {
                    console.warn("Received OK status, but unexpected response content.");
                    if(statusElement) showStatus(statusElement, `تم الاستلام برد غير متوقع: "${responseText.substring(0, 50)}..."`, 'warning');
                     setTimeout(() => hideStatus(statusElement), 4000);
                    return false;
                }
            } else {
                const errorText = await response.text();
                console.error(`Workspace Request Failed! Status: ${response.status}`, errorText);
                if(statusElement) showStatus(statusElement, `فشل ${response.status}: ${errorText || 'لا يوجد رد'}`, 'error');
                 setTimeout(() => hideStatus(statusElement), 5000);
                return false;
            }
        } catch (error) {
            console.error("ESP Send Error:", error);
            let errorMessage = "فشل الاتصال بالروبوت";
            if (error.name === 'AbortError') {
                errorMessage = "انتهى وقت الاتصال بالروبوت (Timeout)";
            } else {
                errorMessage += `: ${error.message}`;
            }
            if(statusElement) showStatus(statusElement, errorMessage, 'error');
             setTimeout(() => hideStatus(statusElement), 5000);
            return false;
        }
    }

    // --- وظائف الإدخال ---
    async function handleQrScan() {
        if (isScanningPaused) {
            console.log("Scanning paused, ignoring input.");
            return;
        }
        const qrInput = getEl('qrInput');
        const scanStatus = getEl('scanStatus');
        if (!qrInput || !scanStatus) {
            console.error("QR Input or Scan Status element not found for handleQrScan.");
            return;
        }
        const qrData = qrInput.value.trim().toUpperCase();
        qrInput.value = '';
        if (qrData === '') {
             qrInput.focus();
             return;
        }
        console.log(`Processing QR scan: ${qrData}`);
        if (['A', 'B', 'C', 'D'].includes(qrData)) {
            const currentItemInventory = inventory[qrData] || 0;
            const currentTotalInventory = Object.values(inventory).reduce((sum, qty) => sum + qty, 0);
            const currentScannedCount = currentScannedItems.length;
            const projectedItemStock = currentItemInventory + currentScannedItems.filter(item => item.type === qrData).length + 1;
             if (projectedItemStock > MAX_STOCK_PER_TYPE) {
                 showStatus(scanStatus, `المخزون ممتلئ للصنف ${qrData} (الحد الأقصى ${MAX_STOCK_PER_TYPE}). لا يمكن الإضافة.`, 'error');
                 setTimeout(() => hideStatus(scanStatus), 4000);
                 qrInput.focus();
                 console.log(`Projected inventory full for ${qrData} (${projectedItemStock}/${MAX_STOCK_PER_TYPE}). Scan rejected.`);
                 return;
            }
             const projectedTotalStock = currentTotalInventory + currentScannedCount + 1;
             if (projectedTotalStock > TOTAL_MAX_INVENTORY) {
                  showStatus(scanStatus, `المخزون الإجمالي ممتلئ (الحد الأقصى ${TOTAL_MAX_INVENTORY}). لا يمكن إضافة المزيد.`, 'error');
                  setTimeout(() => hideStatus(scanStatus), 4000);
                  qrInput.focus();
                  console.log(`Projected total inventory full (${projectedTotalStock}/${TOTAL_MAX_INVENTORY}). Scan rejected.`);
                  return;
             }
            console.log(`Inventory checks passed for ${qrData}. Proceeding.`);
            qrInput.disabled = true;
            isScanningPaused = true;
            showStatus(scanStatus, `تم التعرف [${qrData}]. جاري الإرسال...`, 'info');
            console.log(`Valid QR scanned: ${qrData}. Sending to ESP.`);
            const success = await sendDataToESP(qrData, 'input');
            if (success) {
                const newItem = { type: qrData, scanTime: new Date().toISOString() };
                currentScannedItems.push(newItem);
                updateScannedItemsDisplay();
                console.log(`Item ${qrData} added to scanned items.`);
                startScanDelay(qrData);
            } else {
                qrInput.disabled = false;
                isScanningPaused = false;
                qrInput.focus();
                console.warn(`Failed to send or confirm ${qrData} scan.`);
            }
        } else {
            showStatus(scanStatus, `رمز غير صالح (${qrData}).`, 'error');
            setTimeout(() => hideStatus(scanStatus), 3000);
            qrInput.focus();
            console.warn(`Invalid QR scanned: ${qrData}`);
        }
    }

    function startScanDelay(itemType) {
        const delaySeconds = config.scanDelay || 10;
        let countdown = delaySeconds;
        const qrInput = getEl('qrInput');
        const scanStatus = getEl('scanStatus');
        if (!qrInput || !scanStatus) {
            console.error("QR Input or Scan Status element not found for startScanDelay.");
            return;
        }
        qrInput.disabled = true;
        isScanningPaused = true;
        showStatus(scanStatus, `تم استلام [${itemType}]. انتظر ${countdown} ثواني...`, 'warning');
        console.log(`Starting scan delay (${delaySeconds}s) for ${itemType}.`);
        clearTimeout(scanPauseTimeoutId);
        clearInterval(scanPauseIntervalId);
        scanPauseIntervalId = setInterval(() => {
            countdown--;
            if (countdown >= 0) {
                showStatus(scanStatus, `تم استلام [${itemType}]. انتظر ${countdown} ثواني...`, 'warning');
            }
        }, 1000);
         scanPauseTimeoutId = setTimeout(() => {
             clearInterval(scanPauseIntervalId);
             qrInput.disabled = false;
             isScanningPaused = false;
             qrInput.focus();
             hideStatus(scanStatus);
             console.log("Scan delay finished. Input re-enabled.");
         }, delaySeconds * 1000);
    }

    function updateScannedItemsDisplay() {
         const scannedItemsList = getEl('scannedItemsList');
         const scannedCount = getEl('scannedCount');
         if (!scannedItemsList || !scannedCount) {
             console.warn("Scanned items display elements not found. Cannot update display.");
             return;
         }
         scannedItemsList.innerHTML = '';
         if (currentScannedItems.length === 0) {
             scannedItemsList.innerHTML = '<li><i>لم يتم مسح أي أصناف بعد.</i></li>';
              console.log("No scanned items, displaying empty message.");
         } else {
             [...currentScannedItems].reverse().forEach(item => {
                 const li = document.createElement('li');
                 li.classList.add('scanned-item');
                 li.innerHTML = `<span class="item-type-tag item-${item.type ? item.type.toLowerCase() : 'unknown'}">${item.type || 'غير معروف'}</span> <span class="scan-time">${item.scanTime ? new Date(item.scanTime).toLocaleTimeString('ar-EG') : '-'}</span>`;
                 scannedItemsList.appendChild(li);
             });
         }
         scannedCount.textContent = currentScannedItems.length;
         console.log(`Scanned items display updated. Count: ${currentScannedItems.length}`);
    }

    function completeInputOperation() {
        console.log("Completing input operation...");
        if (currentScannedItems.length === 0) {
            alert("لم يتم مسح أي بضاعة لحفظها!");
            console.warn("Attempted to complete input operation with no scanned items.");
            return;
        }
        const tempInventory = { ...inventory };
        currentScannedItems.forEach(item => {
             if (item.type && tempInventory.hasOwnProperty(item.type)) {
                 tempInventory[item.type] = (tempInventory[item.type] || 0) + 1;
             }
        });
        const totalAfterInput = Object.values(tempInventory).reduce((sum, qty) => sum + qty, 0);
        for(const itemType in tempInventory) {
             if (tempInventory[itemType] > MAX_STOCK_PER_TYPE) {
                  alert(`لا يمكن إكمال العملية: إضافة هذه الأصناف ستجعل مخزون صنف ${itemType} يتجاوز الحد الأقصى (${MAX_STOCK_PER_TYPE}).`);
                  console.error(`Final check failed: Input exceeds max stock per type for ${itemType}.`);
                  return;
             }
        }
         if (totalAfterInput > TOTAL_MAX_INVENTORY) {
              alert(`لا يمكن إكمال العملية: إضافة هذه الأصناف ستجعل إجمالي المخزون يتجاوز الحد الأقصى (${TOTAL_MAX_INVENTORY}).`);
              console.error(`Final check failed: Input exceeds total max inventory.`);
              return;
         }
         console.log("Final inventory check passed for input operation.");
        const nextOpNumber = config.lastOpNumber + 1;
        const operation = {
            operationNumber: nextOpNumber,
            id: generateUniqueId(),
            type: 'input',
            customerName: currentOperationData.customerName || 'غير محدد',
            customerPhone: currentOperationData.customerPhone || '',
            timestamp: new Date().toISOString(),
            items: [...currentScannedItems]
        };
        addOperationToHistory(operation);
        currentScannedItems.forEach(item => {
            if (item.type && inventory.hasOwnProperty(item.type)) {
                 inventory[item.type] = (inventory[item.type] || 0) + 1;
                 console.log(`Increasing inventory for ${item.type} on completion.`);
            } else {
                 console.warn("Skipping inventory increase for invalid item type:", item.type);
            }
        });
        saveInventory();
        config.lastOpNumber = nextOpNumber;
        updateCustomerData(operation.customerName, operation.customerPhone);
        saveConfig();
        showStatus(getEl('generalStatus'), `تم حفظ عملية الإدخال #${operation.operationNumber} (${currentScannedItems.length} صنف).`, 'success');
        console.log(`Input operation #${operation.operationNumber} completed and saved.`);
        checkForLowStock();
        setTimeout(() => {
            resetCurrentOperation();
            showScreen(screens.welcome);
            hideStatus(getEl('generalStatus'));
        }, 3000);
    }

    // --- وظائف الإخراج ---
    function resetOutputQuantities() {
        console.log("Resetting output quantities.");
        const qInputs = getQuantityInputs();
        if(qInputs.A || qInputs.B || qInputs.C || qInputs.D) {
             Object.values(qInputs).forEach(i => { if(i) i.value = 0; });
        } else {
             console.warn("Quantity inputs not found for resetOutputQuantities.");
        }
        const totalRequestedEl = getEl('totalRequested');
        if(totalRequestedEl) totalRequestedEl.textContent = 0;
        else console.warn("#totalRequested not found for reset.");
        hideStatus(getEl('outputError'));
    }

    function getQuantityInputs() {
         const inputs = {
             A: getEl('quantityA'),
             B: getEl('quantityB'),
             C: getEl('quantityC'),
             D: getEl('quantityD')
         };
         return inputs;
    }

    function updateTotalRequested() {
        let t = 0;
        const qInputs = getQuantityInputs();
         let allInputsExist = true;
         for(const type in qInputs) {
             if (!qInputs[type]) {
                 allInputsExist = false;
                 console.warn(`Quantity input for type ${type} not found during total calculation.`);
                 break;
             }
         }
         if(allInputsExist) {
             Object.values(qInputs).forEach(i => { t += parseInt(i.value) || 0; });
         } else {
              console.error("Cannot calculate total requested, some quantity inputs are missing.");
              t = 0;
         }
        const totalRequestedEl = getEl('totalRequested');
        if(totalRequestedEl) totalRequestedEl.textContent = t;
        else console.warn("#totalRequested not found for update.");
        if (t > MAX_TOTAL_OUTPUT) {
            showStatus(getEl('outputError'), `خطأ: المجموع الكلي (${t}) أكبر من الحد الأقصى (${MAX_TOTAL_OUTPUT}).`, 'error');
            console.warn(`Total requested exceeds limit: ${t}`);
            return false;
        } else {
             hideStatus(getEl('outputError'));
             console.log(`Total requested: ${t} (within limit).`);
             return true;
        }
    }

    function checkAvailabilityAndLimits(showErrors = true) {
        let possible = true;
        const qInputs = getQuantityInputs();
         let allInputsExist = true;
         for(const type in qInputs) {
             if (!qInputs[type]) {
                 allInputsExist = false;
                 console.warn(`Quantity input for type ${type} not found during availability check.`);
                 break;
             }
         }
         if(!allInputsExist) {
             console.error("Cannot check availability/limits, some quantity inputs are missing.");
             if(showErrors) showStatus(getEl('outputError'), "خطأ داخلي: عناصر الكمية مفقودة.", 'error');
             return false;
         }
        if(showErrors) hideStatus(getEl('outputError'));
        console.log("Checking individual availability and limits...");
        for (const type in qInputs) {
            const requested = parseInt(qInputs[type].value) || 0;
            const available = inventory[type] || 0;
            if (requested < 0) {
                 if(showErrors) showStatus(getEl('outputError'), `خطأ: كمية سالبة لـ ${type}.`, 'error');
                 possible = false;
                 console.warn(`Negative quantity for ${type}: ${requested}`);
            }
            if (requested > MAX_STOCK_PER_TYPE) {
                 if(showErrors) showStatus(getEl('outputError'), `خطأ: الكمية المطلوبة لـ ${type} (${requested}) تتجاوز الحد الأقصى (${MAX_STOCK_PER_TYPE}).`, 'error');
                 possible = false;
                 console.warn(`Quantity for ${type} exceeds individual limit (${MAX_STOCK_PER_TYPE}): ${requested}`);
            }
            if (requested > available) {
                 if(showErrors) showStatus(getEl('outputError'), `خطأ: الكمية المطلوبة لـ ${type} (${requested}) أكبر من المتاح (${available}).`, 'error');
                 possible = false;
                 console.warn(`Quantity for ${type} exceeds available inventory (${available}): ${requested}`);
            }
        }
        console.log(`Individual availability and limits check result: ${possible}`);
        return possible;
    }

    function updateOutputSummary() {
        console.log("Updating output summary...");
        console.warn("updateOutputSummary called, but likely not used in this version based on provided files.");
     }

    function loadAndDisplayLastInputInfo() {
        console.log("Loading and displaying last input info...");
        const lastInputInfoDiv = getEl('lastInputInfo');
        const fillButton = getEl('fillFromLastInputBtn');
         if (!lastInputInfoDiv || !fillButton) {
             console.warn("Last input info elements not found.");
             return;
         }
        lastInputInfoDiv.innerHTML = '<p><i>جاري البحث عن آخر عملية إدخال...</i></p>';
        fillButton.disabled = true;
        fillButton.dataset.fillData = '';
         if (!Array.isArray(operationsHistory) || operationsHistory.length === 0) {
             lastInputInfoDiv.innerHTML = '<p><i>لا توجد عمليات إدخال سابقة في السجل.</i></p>';
             fillButton.disabled = true;
             console.log("No history loaded or history is empty, cannot display last input info.");
             return;
         }
         const lastInputOp = operationsHistory.find(op =>
             op.type === 'input' && op.items && Array.isArray(op.items) && op.items.length > 0
         );
        if (lastInputOp) {
             console.log("Last input operation found:", lastInputOp);
             const counts = ((lastInputOp.items && Array.isArray(lastInputOp.items)) ? lastInputOp.items : [])
                 .reduce((acc, item) => {
                     if(item && item.type && ['A', 'B', 'C', 'D'].includes(item.type)){
                        acc[item.type] = (acc[item.type] || 0) + 1;
                     }
                     return acc;
                 }, {A:0, B:0, C:0, D:0});
             let infoHtml = `<p><strong>الزبون:</strong> ${lastInputOp.customerName || '-'}</p>`;
             infoHtml += `<p><strong>التاريخ:</strong> ${lastInputOp.timestamp ? new Date(lastInputOp.timestamp).toLocaleDateString('ar-EG') : '-'}</p>`;
             infoHtml += `<p><strong>الأصناف:</strong> (${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(', ')})`;
             infoHtml += `)</p>`;
             lastInputInfoDiv.innerHTML = infoHtml;
             fillButton.disabled = false;
             fillButton.dataset.fillData = JSON.stringify(counts);
             console.log("Last input info loaded and displayed.");
         } else {
             lastInputInfoDiv.innerHTML = '<p><i>لم يتم العثور على عمليات إدخال سابقة تحتوي على أصناف.</i></p>';
             fillButton.disabled = true;
             fillButton.dataset.fillData = '';
             console.log("No previous input operations found with items.");
         }
    }

    function populateOutputFromLastInput() {
        console.log("Attempting to populate output from last input.");
        const fillButton = getEl('fillFromLastInputBtn');
         if (!fillButton) {
             console.error("Fill from last input button not found.");
             return;
         }
        const fillDataString = fillButton.dataset.fillData;
        if (!fillDataString) {
            console.warn("No fill data found in data attribute. Button was likely disabled.");
            return;
        }
        try {
            const lastInputCounts = JSON.parse(fillDataString);
            console.log("Parsed fill data:", lastInputCounts);
            const qInputs = getQuantityInputs();
             let allInputsExist = true;
             for(const type in qInputs) { if (!qInputs[type]) { allInputsExist = false; break; } }
             if(!allInputsExist) {
                 console.error("Quantity inputs not found, cannot populate.");
                 alert("عناصر الكمية غير موجودة لملئها.");
                 return;
             }
            let totalAfterFill = 0;
            for (const type in qInputs) {
                 if (['A', 'B', 'C', 'D'].includes(type) && lastInputCounts.hasOwnProperty(type)) {
                     let requested = parseInt(lastInputCounts[type]) || 0;
                     const available = inventory[type] || 0;
                     requested = Math.min(requested, available, MAX_STOCK_PER_TYPE);
                     qInputs[type].value = requested;
                     totalAfterFill += requested;
                     console.log(`Set quantity for ${type} to ${requested}`);
                 } else {
                     if (qInputs[type]) qInputs[type].value = 0;
                 }
            }
            if (totalAfterFill > MAX_TOTAL_OUTPUT) {
                 console.warn(`Total quantity after filling (${totalAfterFill}) exceeds max (${MAX_TOTAL_OUTPUT}). Alerting user.`);
                 alert(`الكمية الإجمالية بعد الملء التلقائي (${totalAfterFill}) تتجاوز الحد الأقصى (${MAX_TOTAL_OUTPUT}). يرجى التعديل يدوياً.`);
            }
            updateTotalRequested();
            checkAvailabilityAndLimits();
            console.log("Output quantities populated from last input.");
        } catch (e) {
            console.error("Error parsing fill data or populating inputs:", e);
            alert("حدث خطأ أثناء محاولة ملء البيانات من آخر عملية إدخال.");
        }
    }

    async function completeOutputOperation() {
        console.log("Completing output operation...");
        const isIndividualLimitsValid = checkAvailabilityAndLimits(true);
        const isTotalLimitValid = updateTotalRequested();
        if (!isIndividualLimitsValid || !isTotalLimitValid) {
             console.warn("Validation failed for output operation. Stopping.");
             return;
        }
        const requestedQuantities = {};
        let totalItems = 0;
        const qInputs = getQuantityInputs();
         let allInputsExist = true;
         for(const type in qInputs) {
             if (!qInputs[type]) {
                 allInputsExist = false;
                 break;
             }
         }
         if(!allInputsExist) {
             console.error("Quantity inputs are missing, cannot complete output operation.");
             alert("عناصر الكمية مفقودة، لا يمكن إكمال العملية.");
             return;
         }
        for (const type in qInputs) {
            const q = parseInt(qInputs[type].value) || 0;
            if (q > 0) {
                requestedQuantities[type] = q;
                totalItems += q;
            }
        }
        if (totalItems === 0) {
            alert("لم يتم تحديد أي كمية لإخراجها!");
            console.warn("Attempted to complete output operation with 0 total items.");
            return;
        }
        const sendBtn = getEl('sendOutputBtn');
        if (!sendBtn) {
             console.error("Send output button not found.");
             return;
        }
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin icon"></i> جاري الإرسال...';
        console.log("Attempting to send output command to ESP:", requestedQuantities);
        const success = await sendDataToESP(requestedQuantities, 'output');
        if (success) {
            console.log("Output command sent successfully.");
            const nextOpNumber = config.lastOpNumber + 1;
            const operation = {
                operationNumber: nextOpNumber,
                id: generateUniqueId(),
                type: 'output',
                customerName: currentOperationData.customerName || 'غير محدد',
                customerPhone: currentOperationData.customerPhone || '',
                timestamp: new Date().toISOString(),
                itemsRequested: requestedQuantities
            };
            addOperationToHistory(operation);
            decreaseInventory(requestedQuantities);
            config.lastOpNumber = nextOpNumber;
            updateCustomerData(operation.customerName, operation.customerPhone);
            saveConfig();
            showStatus(getEl('generalStatus'), `تم إرسال أمر الإخراج #${operation.operationNumber} وحفظ العملية.`, 'success');
            console.log(`Output operation #${operation.operationNumber} completed and saved.`);
            checkForLowStock();
            setTimeout(() => {
                resetCurrentOperation();
                showScreen(screens.welcome);
                hideStatus(getEl('generalStatus'));
                sendBtn.disabled = false;
                sendBtn.innerHTML = '<i class="fas fa-paper-plane icon"></i> إرسال الطلب للروبوت';
            }, 3000);
        } else {
            console.warn("Failed to complete output operation.");
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="fas fa-paper-plane icon"></i> إرسال الطلب للروبوت';
        }
    }

    function decreaseInventory(quantitiesToDecrease) {
        console.log("Decreasing inventory:", quantitiesToDecrease);
        for (const itemType in quantitiesToDecrease) {
            const qty = parseInt(quantitiesToDecrease[itemType]) || 0;
            if (inventory.hasOwnProperty(itemType) && qty > 0) {
                inventory[itemType] = (inventory[itemType] || 0) - qty;
                if (inventory[itemType] < 0) inventory[itemType] = 0;
                console.log(`Decreased inventory for ${itemType} by ${qty}. New stock: ${inventory[itemType]}`);
            } else {
                 console.warn(`Skipping inventory decrease for invalid item type or zero quantity: ${itemType}, Quantity: ${qty}`);
            }
        }
        saveInventory();
    }

    // دالة لإضافة عملية للسجل وتحديث بيانات العميل
    function addOperationToHistory(operation) {
        operationsHistory.unshift(operation); // إضافة العملية الجديدة في بداية السجل
        saveHistory();
        // تحديث بيانات العميل (اسم، هاتف، آخر نشاط، عدد العمليات)
        // لا يتم استدعاء updateCustomerData هنا مباشرة، بل من completeInput/OutputOperation
        console.log(`Operation #${operation.operationNumber} added to history.`);
    }


    function updateCustomerData(name, phone) {
        console.log("Updating customer data:", name, phone);
        if (!name || name.trim() === '') {
            console.log("No customer name provided, skipping customer data update.");
            return;
        }
        const trimmedName = name.trim();
        const trimmedPhone = phone ? phone.trim() : '';
        if (!customers[trimmedName]) {
            customers[trimmedName] = {
                phone: trimmedPhone,
                lastActivity: new Date().toISOString(),
                operationCount: 0
            };
            console.log(`New customer record created for: ${trimmedName}`);
        } else {
            customers[trimmedName].phone = trimmedPhone || customers[trimmedName].phone;
            customers[trimmedName].lastActivity = new Date().toISOString();
            console.log(`Existing customer record updated for: ${trimmedName}`);
        }
        customers[trimmedName].operationCount++;
        saveCustomers();
        console.log("Customer data saved.", customers[trimmedName]);
    }

    function displayCustomerList() {
        console.log("displayCustomerList called. Customers:", customers);
        const customerListEl = getEl('customerList');
        if (customerListEl) {
            customerListEl.innerHTML = ''; // مسح القائمة الحالية
            if (Object.keys(customers).length === 0) {
                customerListEl.innerHTML = '<li><i>لا يوجد زبائن سابقون.</i></li>';
                return;
            }
            // ترتيب الزبائن حسب آخر نشاط (الأحدث أولاً)
            const sortedCustomers = Object.entries(customers)
                .sort(([, a], [, b]) => new Date(b.lastActivity) - new Date(a.lastActivity));

            sortedCustomers.forEach(([name, data]) => {
                const li = document.createElement('li');
                li.textContent = `${name} (${data.phone || 'لا يوجد هاتف'})`;
                li.dataset.name = name;
                li.dataset.phone = data.phone || '';
                li.addEventListener('click', () => {
                    getEl('customerName').value = name;
                    getEl('customerPhone').value = data.phone || '';
                    // إزالة الخطأ إذا كان موجودًا
                    const customerNameErrorEl = getEl('customerNameError');
                    if(customerNameErrorEl) customerNameErrorEl.textContent = '';
                    getEl('customerName').style.borderColor = '';
                });
                customerListEl.appendChild(li);
            });
        } else {
            console.warn("#customerList element not found.");
        }
    }

    // --- وظائف عرض وتصدير السجل ---
    function displayHistory() {
        console.log("Displaying history...");
        const operationsLog = getEl('operationsLog');
         if (!operationsLog) {
             console.error("Operations log element #operationsLog not found. Cannot display history.");
             return;
         }
        operationsLog.innerHTML = '';
        if (!Array.isArray(operationsHistory) || operationsHistory.length === 0) {
            operationsLog.innerHTML = '<p>لا توجد عمليات مسجلة.</p>';
            console.log("History is empty, displaying empty message.");
            return;
        }
        operationsHistory.forEach((op, index) => {
             if (!op || typeof op !== 'object' || !op.type || !op.timestamp) {
                 console.warn("Skipping invalid operation entry in history:", op);
                 return;
             }
            const entryDiv = document.createElement('div');
            entryDiv.classList.add('log-entry');
            entryDiv.dataset.id = op.id || `index-${index}`;
            let itemsSummary = '';
            if (op.type === 'input') {
                const c = ((op.items && Array.isArray(op.items)) ? op.items : [])
                    .reduce((a, i) => {
                        if(i && i.type && ['A', 'B', 'C', 'D'].includes(i.type)){
                           a[i.type] = (a[i.type] || 0) + 1;
                        } else {
                            console.warn("Skipping invalid item in input summary count:", i);
                        }
                        return a;
                    }, {A:0, B:0, C:0, D:0});
                itemsSummary = `(${Object.entries(c).map(([k, v]) => `${k}:${v}`).join(', ')})`;
            } else if (op.type === 'output' && op.itemsRequested && typeof op.itemsRequested === 'object') {
                 const requestedEntries = Object.entries(op.itemsRequested).filter(([, v]) => parseInt(v) > 0);
                 if (requestedEntries.length > 0) {
                    itemsSummary = `(${requestedEntries.map(([k, v]) => `${k}:${parseInt(v) || 0}`).join(', ')})`;
                 } else {
                      itemsSummary = '(لم يطلب شيء)';
                 }
            } else {
                 itemsSummary = '(لا يوجد تفاصيل أصناف)';
            }
            entryDiv.innerHTML = `
                <div class="log-entry-header">
                    <h4>
                        <span class="op-number">#${op.operationNumber || '-'}</span>
                        <i class="fas ${op.type === 'input' ? 'fa-sign-in-alt' : 'fa-sign-out-alt'} icon"></i>
                        ${op.type === 'input' ? 'إدخال' : (op.type === 'output' ? 'إخراج' : op.type || 'غير معروف')} - ${op.customerName || 'غير محدد'} ${itemsSummary}
                    </h4>
                    <div class="log-meta">${op.timestamp ? new Date(op.timestamp).toLocaleString('ar-EG') : '-'} <i class="fas fa-chevron-down toggle-icon"></i></div>
                </div>
                <div class="log-entry-details">
                    <p><strong>المعرف الفريد:</strong> ${op.id || '-'}</p>
                    <p><strong>الزبون:</strong> ${op.customerName || ''}</p>
                    <p><strong>الهاتف:</strong> ${op.customerPhone || ''}</p>
                    <p><strong>التاريخ:</strong> ${op.timestamp ? new Date(op.timestamp).toLocaleString('ar-EG') : '-'}</p>
                    <p><strong>تفاصيل الأصناف:</strong></p>
                    ${generateItemsTable(op)}
                </div>
            `;
            operationsLog.appendChild(entryDiv);
        });
        operationsLog.querySelectorAll('.log-entry-header').forEach(header => {
            header.addEventListener('click', () => {
                 console.log("History entry header clicked. Toggling details.");
                header.closest('.log-entry').classList.toggle('open');
            });
        });
         console.log("History display updated. Total entries rendered:", operationsHistory.length);
    }

    function generateItemsTable(operation) {
        let tableHTML = '<table><thead><tr><th>الصنف</th>';
        if (operation.type === 'input') {
            tableHTML += '<th>وقت المسح</th></tr></thead><tbody>';
            ((operation.items && Array.isArray(operation.items)) ? operation.items : []).forEach(item => {
                 if (item && typeof item === 'object') {
                    tableHTML += `<tr><td>${item.type || '-'}</td><td>${item.scanTime ? new Date(item.scanTime).toLocaleTimeString('ar-EG') : '-'}</td></tr>`;
                 } else {
                      console.warn("Skipping invalid item in history table:", item);
                 }
            });
            if (!((operation.items && Array.isArray(operation.items)) && operation.items.length > 0)) {
                 tableHTML += `<tr><td>N/A</td><td>لا يوجد أصناف ممسوحة</td></tr>`;
            }
        } else if (operation.type === 'output' && operation.itemsRequested && typeof operation.itemsRequested === 'object') {
            tableHTML += '<th>الكمية المطلوبة</th></tr></thead><tbody>';
             let hasItems = false;
            for (const [type, quantity] of Object.entries(operation.itemsRequested)) {
                 const qty = parseInt(quantity) || 0;
                if (qty > 0) {
                    hasItems = true;
                    tableHTML += `<tr><td>${type}</td><td>${qty}</td></tr>`;
                }
            }
             if (!hasItems) {
                 tableHTML += `<tr><td>N/A</td><td>لم يطلب شيء</td></tr>`;
             }
        } else {
             tableHTML += '<th>الحالة</th></tr></thead><tbody><tr><td>لا يوجد تفاصيل</td><td>-</td></tr>';
        }
        tableHTML += '</tbody></table>';
        return tableHTML;
    }

    function exportSummaryCsv() {
         console.log("Exporting summary CSV...");
         if (!Array.isArray(operationsHistory) || operationsHistory.length === 0) {
             alert("لا توجد بيانات لتصديرها.");
             console.warn("Attempted to export summary CSV with no history data.");
             return;
         }
         const headers = ["رقم العملية", "التاريخ", "الوقت", "نوع العملية", "اسم الزبون", "هاتف الزبون", "الكمية A", "الكمية B", "الكمية C", "الكمية D"];
         let csvRows = [headers.join(";")];
         const fmt = (v) => {
             if(v == null) return '';
             let s = String(v);
             if(s.search(/["\n;]/g) >= 0) s = `"${s.replace(/"/g,'""')}"`;
             return s;
         };
         [...operationsHistory].reverse().forEach(op => {
             if (!op || typeof op !== 'object' || !op.type || !op.timestamp) {
                 console.warn("Skipping invalid operation entry during summary export:", op);
                 return;
             }
             const ts = new Date(op.timestamp);
             const d = isNaN(ts.getTime()) ? '-' : ts.toLocaleDateString('sv-SE');
             const t = isNaN(ts.getTime()) ? '-' : ts.toLocaleTimeString('sv-SE');
             let counts = {A:0, B:0, C:0, D:0};
             if(op.type === 'input' && op.items && Array.isArray(op.items)){
                 op.items.forEach(i=>{
                      if(i && i.type && ['A', 'B', 'C', 'D'].includes(i.type)){
                         counts[i.type]=(counts[i.type]||0)+1;
                      }
                 });
             } else if (op.type === 'output' && op.itemsRequested && typeof op.itemsRequested === 'object') {
                 for(const type in op.itemsRequested){
                      if(['A', 'B', 'C', 'D'].includes(type)){
                         counts[type] = parseInt(op.itemsRequested[type]) || 0;
                      }
                 }
             }
             const row=[
                 op.operationNumber||'-',
                 d,
                 t,
                 op.type === 'input' ? "إدخال" : (op.type === 'output' ? "إخراج" : op.type || 'غير معروف'),
                 op.customerName||'',
                 op.customerPhone||'',
                 counts.A,
                 counts.B,
                 counts.C,
                 counts.D
             ];
             csvRows.push(row.map(fmt).join(";"));
         });
         const csv = "\uFEFF" + csvRows.join("\r\n");
         const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
         const url = URL.createObjectURL(blob);
         const link = document.createElement("a");
         link.href = url;
         link.download = `ملخص_عمليات_المخزن_${new Date().toISOString().slice(0, 10)}.csv`;
         document.body.appendChild(link);
         link.click();
         document.body.removeChild(link);
         URL.revokeObjectURL(url);
         console.log("Summary CSV export initiated.");
    }

    function exportDetailedCsv() {
         console.log("Exporting detailed CSV...");
         if (!Array.isArray(operationsHistory) || operationsHistory.length === 0) {
             alert("لا توجد بيانات لتصديرها.");
             console.warn("Attempted to export detailed CSV with no history data.");
             return;
         }
         const headers = ["رقم العملية", "المعرف الفريد", "تاريخ العملية", "وقت العملية", "نوع العملية", "اسم الزبون", "هاتف الزبون", "الصنف", "الكمية", "ملاحظات/وقت المسح"];
         let csvRows = [headers.join(";")];
         const fmt = (v) => {
             if(v == null) return '';
             let s = String(v);
             if(s.search(/["\n;]/g) >= 0) s = `"${s.replace(/"/g,'""')}"`;
             return s;
         };
         [...operationsHistory].reverse().forEach(op => {
             if (!op || typeof op !== 'object' || !op.type || !op.timestamp) {
                 console.warn("Skipping invalid operation entry during detailed export:", op);
                 return;
             }
             const ts = new Date(op.timestamp);
             const d = isNaN(ts.getTime()) ? '-' : ts.toLocaleDateString('sv-SE');
             const t = isNaN(ts.getTime()) ? '-' : ts.toLocaleTimeString('sv-SE');
             const name = op.customerName||'';
             const phone = op.customerPhone||'';
             const opNumber = op.operationNumber || '-';
             const opId = op.id || '-';
             const opType = op.type === 'input' ? "إدخال" : (op.type === 'output' ? "إخراج" : op.type || 'غير معروف');
             if(op.type === 'input' && op.items && Array.isArray(op.items)){
                 let itemsAdded = false;
                 op.items.forEach(item=>{
                      if (item && typeof item === 'object') {
                          itemsAdded = true;
                          const st = item.scanTime ? new Date(item.scanTime) : null;
                          const stFmt = st && !isNaN(st.getTime()) ? st.toLocaleTimeString('sv-SE') : '-';
                          const itemType = item.type || '-';
                          const row = [
                              opNumber, opId, d, t, opType, name, phone,
                              itemType, 1, `Scan: ${stFmt}`
                          ];
                          csvRows.push(row.map(fmt).join(";"));
                      } else {
                           console.warn("Skipping invalid item in history during detailed export:", item);
                      }
                 });
                 if (!itemsAdded) {
                     const row = [opNumber, opId, d, t, opType, name, phone, "N/A", 0, "No items scanned"];
                     csvRows.push(row.map(fmt).join(";"));
                 }
             } else if (op.type === 'output' && op.itemsRequested && typeof op.itemsRequested === 'object') {
                 let addedItems = false;
                 for(const type in op.itemsRequested){
                     const qty = parseInt(op.itemsRequested[type]) || 0;
                     if (qty > 0){
                         addedItems = true;
                         const itemType = type || '-';
                         const row = [
                             opNumber, opId, d, t, opType, name, phone,
                             itemType, qty, "Request"
                         ];
                         csvRows.push(row.map(fmt).join(";"));
                     }
                 }
                 if (!addedItems) {
                     const row = [opNumber, opId, d, t, opType, name, phone, "N/A", 0, "No items requested"];
                     csvRows.push(row.map(fmt).join(";"));
                 }
             } else {
                 const row = [opNumber, opId, d, t, opType, name, phone, "N/A", 0, "No item data"];
                 csvRows.push(row.map(fmt).join(";"));
             }
         });
         const csv = "\uFEFF" + csvRows.join("\r\n");
         const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
         const url = URL.createObjectURL(blob);
         const link = document.createElement("a");
         link.href = url;
         link.download = `سجل_تفصيلي_عمليات_المخزن_${new Date().toISOString().slice(0, 10)}.csv`;
         document.body.appendChild(link);
         link.click();
         document.body.removeChild(link);
         URL.revokeObjectURL(url);
         console.log("Detailed CSV export initiated.");
    }

    // --- EmailJS Integration ---
     function checkForLowStock() {
         console.log("Checking for low stock...");
          let lowStockItems = [];
          let zeroStockItems = [];
          let isLow = false;
          for (const itemType in inventory) {
               const stock = inventory[itemType];
               if (stock <= 1 && stock >= 0) { // Check if stock is 1 or 0
                   lowStockItems.push({ type: itemType, stock: stock });
                   isLow = true;
                   if (stock === 0) {
                       zeroStockItems.push(itemType);
                   }
               }
          }
          if (isLow) {
               console.log("Low stock detected. Sending email...");
               sendLowStockEmail(lowStockItems, zeroStockItems);
          } else {
               console.log("Stock levels are sufficient.");
          }
     }

     function sendLowStockEmail(lowStockItems, zeroStockItems) {
         if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY || EMAILJS_PUBLIC_KEY === 'YOUR_EMAILJS_PUBLIC_KEY') {
              console.warn("EmailJS is not configured properly. Cannot send email.");
              return;
         }
         const templateParams = {
              stock_A: inventory.A,
              stock_B: inventory.B,
              stock_C: inventory.C,
              stock_D: inventory.D,
             total_stock_remaining: Object.values(inventory).reduce((sum, qty) => sum + qty, 0),
              zero_stock_types: zeroStockItems.length > 0 ? zeroStockItems.join(', ') : 'لا يوجد',
              warning_time: new Date().toLocaleString('ar-EG'),
              warehouse_status_link: window.location.href
         };
         console.log("Sending EmailJS with params:", templateParams);
          emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams)
             .then((response) => {
                console.log('Email sent successfully!', response.status, response.text);
             }, (error) => {
                console.error('Failed to send email:', error);
                 showStatus(getEl('generalStatus'), 'فشل إرسال تنبيه انخفاض المخزون. يرجى التحقق من إعدادات EmailJS والاتصال بالإنترنت.', 'error');
                 setTimeout(() => hideStatus(getEl('generalStatus')), 5000);
             });
     }

    // --- إعداد مستمعي الأحداث ---
    function setupEventListeners() {
        console.log("Setting up event listeners...");

        const startNewBtn = getEl('startNewBtn');
        const viewHistoryBtn = getEl('viewHistoryBtn');
        const standbyBtn = getEl('standbyBtn');
        const sleepBtn = getEl('sleepBtn');

        if (startNewBtn) {
            console.log("Attaching listener to #startNewBtn");
            startNewBtn.addEventListener('click', () => {
                console.log("Start New Operation button clicked.");
                resetCurrentOperation();
                showStep(1);
                showScreen(screens.operation);
            });
        } else { console.warn("#startNewBtn not found."); }

        if (viewHistoryBtn) {
            console.log("Attaching listener to #viewHistoryBtn");
            viewHistoryBtn.addEventListener('click', async () => {
                console.log("View History button clicked. Prompting for password.");
                const enteredPassword = await promptForPasswordModal("الرجاء إدخال كلمة المرور لعرض السجلات:");
                if (enteredPassword === null) {
                    console.log("Password prompt cancelled for history.");
                    return;
                }
                if (checkPassword(enteredPassword)) {
                    console.log("Password correct. Showing history screen.");
                    closePasswordPrompt(true);
                    loadHistory(); // Load fresh history data
                    displayHistory();
                    const historyContentEl = getEl('historyContent');
                    if (historyContentEl) {
                        historyContentEl.style.display = 'block';
                        console.log("#historyContent display set to block.");
                    } else {
                        console.error("#historyContent not found after password check.");
                        alert("عنصر عرض السجل غير موجود في الصفحة.");
                         showScreen(screens.welcome);
                        return;
                    }
                    showScreen(screens.history);
                } else {
                    console.warn("Incorrect password entered for history.");
                }
            });
        } else { console.warn("#viewHistoryBtn not found. Cannot attach listener."); }

        if (standbyBtn) {
            console.log("Attaching listener to #standbyBtn");
            standbyBtn.addEventListener('click', () => {
                console.log("Standby button clicked.");
                sendDataToESP('S', 'command');
            });
        } else { console.warn("#standbyBtn not found."); }

        if (sleepBtn) {
            console.log("Attaching listener to #sleepBtn");
            sleepBtn.addEventListener('click', () => {
                console.log("Sleep button clicked.");
                sendDataToESP('M', 'command');
            });
        } else { console.warn("#sleepBtn not found."); }

        const connectionSettingsBtn = getEl('connectionSettingsBtn');
        const connectionSettingsOverlay = getEl('connectionSettingsOverlay');
        const saveConnectionSettingsBtn = getEl('saveConnectionSettingsBtn');
        const cancelConnectionSettingsBtn = getEl('cancelConnectionSettingsBtn');
        const espIpInput = getEl('espIpInput');
        const espPortInput = getEl('espPortInput');
        const connectionSettingsStatus = getEl('connectionSettingsStatus');

        if (connectionSettingsBtn && connectionSettingsOverlay) {
            connectionSettingsBtn.addEventListener('click', () => {
                if (espIpInput) espIpInput.value = connectionSettings.ip;
                if (espPortInput) espPortInput.value = connectionSettings.port;
                connectionSettingsOverlay.classList.add('active');
            });
        }

        if (cancelConnectionSettingsBtn && connectionSettingsOverlay) {
            cancelConnectionSettingsBtn.addEventListener('click', () => {
                connectionSettingsOverlay.classList.remove('active');
                hideStatus(connectionSettingsStatus);
            });
        }

        if (saveConnectionSettingsBtn && espIpInput && espPortInput && connectionSettingsStatus) {
            saveConnectionSettingsBtn.addEventListener('click', () => {
                const newIp = espIpInput.value.trim();
                const newPort = espPortInput.value.trim();
                if (!isValidIp(newIp)) {
                    showStatus(connectionSettingsStatus, "عنوان IP غير صالح. مثال: 192.168.1.100", 'error');
                    return;
                }
                if (!isValidPort(newPort)) {
                    showStatus(connectionSettingsStatus, "منفذ غير صالح. يجب أن يكون بين 1 و 65535", 'error');
                    return;
                }
                connectionSettings.ip = newIp;
                connectionSettings.port = newPort || "80";
                if (saveConnectionSettings()) {
                    showStatus(connectionSettingsStatus, "تم حفظ إعدادات الاتصال بنجاح!", 'success');
                    setTimeout(() => {
                        connectionSettingsOverlay.classList.remove('active');
                        hideStatus(connectionSettingsStatus);
                    }, 1500);
                } else {
                    showStatus(connectionSettingsStatus, "حدث خطأ أثناء حفظ الإعدادات", 'error');
                }
            });
        } else {
             console.warn("Connection settings elements not found. Cannot attach save listener.");
        }

        if (submitPasswordBtn && passwordInput && passwordOverlay && passwordError) {
            submitPasswordBtn.addEventListener('click', () => {
                console.log("Password submit button clicked.");
                const enteredPassword = passwordInput.value;
                if (passwordResolve) {
                     closePasswordPrompt(enteredPassword);
                } else {
                     console.warn("Password submit clicked but no active passwordResolve promise.");
                     closePasswordPrompt(null);
                 }
            });
            passwordInput.addEventListener('keypress', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    submitPasswordBtn.click();
                }
            });
        } else {
             console.warn("Password modal submit elements not found. Cannot attach listeners.");
        }

        if (backToWelcomeFromPwd && passwordOverlay) {
             backToWelcomeFromPwd.addEventListener('click', () => {
                 console.log("Back to Welcome from Password modal clicked.");
                 if (passwordResolve) {
                     closePasswordPrompt(null);
                 } else {
                     closePasswordPrompt(null);
                 }
                 showScreen(screens.welcome);
             });
        } else {
             console.warn("Back to Welcome from Password button not found.");
        }

        const nextBtnStep1 = formSteps.find(step => parseInt(step.dataset.step) === 1)?.querySelector('.next-btn');
        const customerNameInput = getEl('customerName');
        const actionTypeRadios = document.querySelectorAll('input[name="actionType"]');
        const actionTypeErrorEl = getEl('actionTypeError');
        const customerNameErrorEl = getEl('customerNameError');

        if (nextBtnStep1 && customerNameInput && actionTypeRadios.length > 0 && actionTypeErrorEl && customerNameErrorEl) {
            console.log("Attaching listener to Step 1 Next button.");
            nextBtnStep1.addEventListener('click', () => {
                console.log("Step 1 Next button clicked.");
                let isValid = true;
                if (customerNameInput.value.trim() === '') {
                    customerNameErrorEl.textContent = "الرجاء إدخال اسم الشركة أو الشخص.";
                    customerNameInput.style.borderColor = '#dc3545';
                    isValid = false;
                    console.warn("Customer name is empty.");
                } else {
                    customerNameErrorEl.textContent = '';
                    customerNameInput.style.borderColor = '';
                    console.log("Customer name is valid.");
                }
                let selectedActionType = null;
                actionTypeRadios.forEach(radio => {
                    if (radio.checked) {
                        selectedActionType = radio.value;
                    }
                });
                if (!selectedActionType) {
                    actionTypeErrorEl.textContent = "الرجاء تحديد نوع العملية (إدخال أو إخراج).";
                     const radioGroupDiv = actionTypeErrorEl.closest('.form-group');
                     if(radioGroupDiv) radioGroupDiv.style.border = '1px solid #dc3545';
                    isValid = false;
                    console.warn("No action type selected.");
                } else {
                    actionTypeErrorEl.textContent = '';
                     const radioGroupDiv = actionTypeErrorEl.closest('.form-group');
                     if(radioGroupDiv) radioGroupDiv.style.border = '';
                    currentOperationType = selectedActionType;
                    console.log(`Action type selected: ${currentOperationType}`);
                }
                if (isValid) {
                    console.log("Step 1 validation passed. Proceeding to step 2.");
                    currentOperationData.customerName = customerNameInput.value.trim();
                    currentOperationData.customerPhone = getEl('customerPhone').value.trim();
                    showStep(2);
                } else {
                     console.warn("Step 1 validation failed.");
                }
            });
            customerNameInput.addEventListener('input', () => {
                if (customerNameInput.value.trim() !== '') {
                    customerNameErrorEl.textContent = '';
                    customerNameInput.style.borderColor = '';
                }
            });
             customerNameInput.addEventListener('blur', () => {
                 if (customerNameInput.value.trim() === '') {
                     customerNameErrorEl.textContent = "الرجاء إدخال اسم الشركة أو الشخص.";
                     customerNameInput.style.borderColor = '#dc3545';
                 }
             });
            actionTypeRadios.forEach(radio => {
                radio.addEventListener('change', () => {
                     console.log(`Radio button for ${radio.value} changed.`);
                     const radioGroupDiv = actionTypeErrorEl.closest('.form-group');
                     if(radioGroupDiv) radioGroupDiv.style.border = '';
                     actionTypeErrorEl.textContent = '';
                     const labels = radio.closest('.radio-group-horizontal').querySelectorAll('label');
                     labels.forEach(label => label.classList.remove('selected'));
                     if (radio.checked) {
                        radio.closest('label').classList.add('selected');
                        currentOperationType = radio.value;
                        console.log(`Action type selected: ${currentOperationType}`);
                     } else {
                          currentOperationType = null;
                     }
                });
            });
        } else {
             console.warn("Step 1 navigation or validation elements not found. Cannot attach listener.");
        }

        const finishInputBtn = getEl('finishInputBtn');
        const qrInput = getEl('qrInput');
        const saveDelayBtn = getEl('saveDelayBtn');
        const scanDelayInput = getEl('scanDelayInput');

        if (finishInputBtn) {
            console.log("Attaching listener to #finishInputBtn");
            finishInputBtn.addEventListener('click', completeInputOperation);
        } else { console.warn("#finishInputBtn not found."); }

        if (qrInput) {
            console.log("Attaching listener to #qrInput");
            qrInput.addEventListener('keypress', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    handleQrScan();
                }
            });
        } else { console.warn("#qrInput not found."); }

        if (saveDelayBtn && scanDelayInput) {
             console.log("Attaching listener to #saveDelayBtn");
             saveDelayBtn.addEventListener('click', saveScanDelay);
             scanDelayInput.addEventListener('change', saveScanDelay);
        } else {
             console.warn("#saveDelayBtn or #scanDelayInput not found.");
        }

        function saveScanDelay() {
            const delayInput = getEl('scanDelayInput');
            if (!delayInput) {
                console.error("Scan Delay Input element not found.");
                return;
            }
            const delay = parseInt(delayInput.value);
            if (!isNaN(delay) && delay >= 0) {
                config.scanDelay = delay;
                saveConfig();
                console.log("Scan delay saved:", config.scanDelay);
            } else {
                 console.warn("Invalid scan delay value:", delayInput.value);
            }
        }

        const sendOutputBtn = getEl('sendOutputBtn');
        const fillFromLastInputBtn = getEl('fillFromLastInputBtn');

        if (sendOutputBtn) {
            console.log("Attaching listener to #sendOutputBtn");
            sendOutputBtn.addEventListener('click', completeOutputOperation);
        } else { console.warn("#sendOutputBtn not found."); }

         if (fillFromLastInputBtn) {
             console.log("Attaching listener to #fillFromLastInputBtn");
             fillFromLastInputBtn.addEventListener('click', populateOutputFromLastInput);
         } else {
              console.warn("#fillFromLastInputBtn not found.");
         }

        const prevBtns = screens.operation.querySelectorAll('.prev-btn');
        if (prevBtns.length > 0) {
            console.log(`Attaching listeners to ${prevBtns.length} .prev-btn elements.`);
            prevBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    console.log("Previous button clicked.");
                    if (currentStep > 1) {
                        showStep(currentStep - 1);
                    }
                });
            });
        } else { console.warn("Previous buttons (.prev-btn) not found."); }

        const cancelOpBtns = screens.operation.querySelectorAll('.btn-cancel');
         if (cancelOpBtns.length > 0) {
             console.log(`Attaching listeners to ${cancelOpBtns.length} .btn-cancel elements.`);
             cancelOpBtns.forEach(btn => {
                 btn.addEventListener('click', () => {
                     console.log("Cancel button clicked.");
                     if (confirm("هل أنت متأكد من إلغاء العملية الحالية؟ سيتم فقدان أي بيانات لم يتم حفظها.")) {
                         resetCurrentOperation();
                         showScreen(screens.welcome);
                         showStatus(getEl('generalStatus'), "تم إلغاء العملية.", 'info');
                         setTimeout(() => hideStatus(getEl('generalStatus')), 2000);
                         console.log("Operation cancelled.");
                     }
                 });
             });
         } else {
              console.warn("Cancel buttons (.btn-cancel) not found.");
         }

        const backToWelcomeFromHistoryBtn = getEl('backToWelcomeFromHistory');
        const exportSummaryCsvBtn = getEl('exportSummaryCsvBtn');
        const exportDetailedCsvBtn = getEl('exportDetailedCsvBtn');
        const changePasswordBtn = getEl('changePasswordBtn');
        const deleteHistoryBtn = getEl('deleteHistoryBtn');

        if (backToWelcomeFromHistoryBtn) {
            console.log("Attaching listener to #backToWelcomeFromHistory");
            backToWelcomeFromHistoryBtn.addEventListener('click', () => {
                console.log("Back to Welcome from History button clicked.");
                const historyContentEl = getEl('historyContent');
                if(historyContentEl) historyContentEl.style.display = 'none';
                 else console.warn("#historyContent not found when returning from history.");
                showScreen(screens.welcome);
            });
        } else { console.warn("#backToWelcomeFromHistory not found."); }

        if (exportSummaryCsvBtn) {
            console.log("Attaching listener to #exportSummaryCsvBtn");
            exportSummaryCsvBtn.addEventListener('click', exportSummaryCsv);
        } else { console.warn("#exportSummaryCsvBtn not found."); }

        if (exportDetailedCsvBtn) {
            console.log("Attaching listener to #exportDetailedCsvBtn");
            exportDetailedCsvBtn.addEventListener('click', exportDetailedCsv);
        } else { console.warn("#exportDetailedCsvBtn not found."); }

        if (changePasswordBtn) {
            console.log("Attaching listener to #changePasswordBtn");
            changePasswordBtn.addEventListener('click', handleChangePassword);
        } else { console.warn("#changePasswordBtn not found."); }

        if (deleteHistoryBtn) {
            console.log("Attaching listener to #deleteHistoryBtn");
            deleteHistoryBtn.addEventListener('click', handleDeleteHistory);
        } else { console.warn("#deleteHistoryBtn not found."); }

        console.log("Event listeners setup complete.");
    }

    // --- بدء تشغيل التطبيق ---
    initializeApp(); // Start the application initialization

});
