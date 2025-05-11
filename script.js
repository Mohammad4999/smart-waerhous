document.addEventListener('DOMContentLoaded', () => {
    // --- عناصر الواجهة (اختصارات) ---
    const getEl = (id) => document.getElementById(id);
    const screens = {
        welcome: getEl('welcomeScreen'),
        operation: getEl('operationScreen'),
        history: getEl('historyScreen')
    };
    const formSteps = Array.from(screens.operation.querySelectorAll('.form-step'));

    // --- حالة التطبيق ومعرّفات localStorage ---
    const HISTORY_KEY = 'smartWarehouseHistory_v5';
    const INVENTORY_KEY = 'smartWarehouseInventory_v5';
    const CONFIG_KEY = 'smartWarehouseConfig_v5';
    const CUSTOMERS_KEY = 'smartWarehouseCustomers_v5';
    const DEFAULT_PASSWORD = "0000";
    const MAX_STOCK_PER_TYPE = 4; // الحد الأقصى للمخزون لكل نوع
    // تم تعديل الحد الأقصى الإجمالي ليعكس 4*4 = 16
    const MAX_TOTAL_OUTPUT = 16; // الحد الأقصى الإجمالي للأصناف في عملية إخراج واحدة

    let currentStep = 1;
    let currentOperationType = null;
    let currentOperationData = {};
    let currentScannedItems = []; // Items scanned in the current input operation
    let operationsHistory = [];
    let inventory = { A: 0, B: 0, C: 0, D: 0 };
    let config = { password: DEFAULT_PASSWORD, scanDelay: 10, lastOpNumber: 0 };
    let customers = {}; // { "Name": { phone, lastActivity, operationCount } }
    let isScanningPaused = false;
    let scanPauseTimeoutId = null; // لتتبع مؤقت التأخير
    let scanPauseIntervalId = null; // لتتبع مؤقت عرض العد التنازلي

    // أضف هذه المتغيرات
    const CONNECTION_SETTINGS_KEY = 'smartWarehouseConnectionSettings_v5';
    let connectionSettings = {
        ip: "192.168.137.69", // القيمة الافتراضية
        port: "80"
    };
    // تعريف ESP_BASE_URL هنا ليتم تحديثه عند تحميل الإعدادات
    let ESP_BASE_URL = `http://${connectionSettings.ip}${connectionSettings.port ? ':' + connectionSettings.port : ''}`;


    // دالة لتحميل إعدادات الاتصال
    function loadConnectionSettings() {
        console.log("Loading connection settings..."); // Debugging
        try {
            const storedSettings = localStorage.getItem(CONNECTION_SETTINGS_KEY);
            if (storedSettings) {
                const parsedSettings = JSON.parse(storedSettings);
                 // Ensure ip and port are strings and handle potential null/undefined
                connectionSettings = {
                    ip: parsedSettings.ip ? String(parsedSettings.ip) : "192.168.137.69",
                    port: parsedSettings.port ? String(parsedSettings.port) : "80"
                };
                // تحديث عنوان URL الأساسي
                ESP_BASE_URL = `http://${connectionSettings.ip}${connectionSettings.port ? ':' + connectionSettings.port : ''}`;
                console.log("Connection settings loaded:", connectionSettings);
            } else {
                 // Initial save if no settings exist
                 connectionSettings = { ip: "192.168.137.69", port: "80" };
                 saveConnectionSettings(); // Save defaults
                 ESP_BASE_URL = `http://${connectionSettings.ip}${connectionSettings.port ? ':' + connectionSettings.port : ''}`;
                 console.log("No connection settings in localStorage, saving default.", connectionSettings); // Debugging
            }
        } catch (e) {
            console.error("Error loading connection settings:", e);
             // Reset to default if loading fails
             connectionSettings = { ip: "192.168.137.69", port: "80" };
             saveConnectionSettings(); // Save defaults
             ESP_BASE_URL = `http://${connectionSettings.ip}${connectionSettings.port ? ':' + connectionSettings.port : ''}`;
             console.log("Connection settings load failed, resetting to default.", connectionSettings); // Debugging
        }
    }

    // دالة لحفظ إعدادات الاتصال
    function saveConnectionSettings() {
        try {
            localStorage.setItem(CONNECTION_SETTINGS_KEY, JSON.stringify(connectionSettings));
            // تحديث عنوان URL الأساسي بعد الحفظ
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
    // --- التهيئة الأولية ---


    function initializeApp() {
        console.log("Initializing App..."); // Debugging
        loadConnectionSettings(); // حمل إعدادات الاتصال أولاً
        loadConfig();
        loadInventory();
        loadCustomers();
        loadHistory(); // Load history early
        updateInventorySummary();
        setupEventListeners();
        showScreen(screens.welcome);
         console.log("App initialization finished."); // Debugging
    }

    // --- تحميل وحفظ الإعدادات / كلمة المرور / التأخير ---
    function loadConfig() {
        console.log("Loading config..."); // Debugging
        try {
            const storedConfig = localStorage.getItem(CONFIG_KEY);
            if (storedConfig) {
                const parsedConfig = JSON.parse(storedConfig);
                // Merge loaded config with defaults, ensuring numbers are parsed
                config = {
                    password: parsedConfig.password || DEFAULT_PASSWORD,
                    scanDelay: parseInt(parsedConfig.scanDelay) || 10,
                    lastOpNumber: parseInt(parsedConfig.lastOpNumber) || 0
                };
                console.log("Config loaded from localStorage.", config); // Debugging
            } else {
                 // Initial save if no config exists
                config = { password: DEFAULT_PASSWORD, scanDelay: 10, lastOpNumber: 0 };
                saveConfig();
                console.log("No config in localStorage, saving default.", config); // Debugging
            }
        } catch (e) {
            console.error(`Error loading config (${CONFIG_KEY}):`, e);
            // Reset to default if loading fails
            config = { password: DEFAULT_PASSWORD, scanDelay: 10, lastOpNumber: 0 };
            saveConfig();
             console.log("Config load failed, resetting to default.", config); // Debugging
        }
        // Final check and update input value
        if (config.scanDelay < 1 || config.scanDelay > 60) config.scanDelay = 10;
        const scanDelayInputEl = getEl('scanDelayInput');
        if(scanDelayInputEl) scanDelayInputEl.value = config.scanDelay;
    }

    function saveConfig() {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
         console.log("Config saved to localStorage.", config); // Debugging
    }

    // Password saving function remains for the Change Password feature
    function savePassword(newPassword) {
        config.password = newPassword;
        saveConfig();
        alert("تم تغيير كلمة المرور بنجاح.");
        console.log("Password changed and saved."); // Debugging
    }

    function saveScanDelay() {
        const scanDelayInputEl = getEl('scanDelayInput');
        if(!scanDelayInputEl) {
             console.warn("Scan delay input element not found."); // Debugging
             return;
        }

        const newDelay = parseInt(scanDelayInputEl.value);
        if (newDelay >= 1 && newDelay <= 60) {
            config.scanDelay = newDelay;
            saveConfig();
            showStatus(getEl('generalStatus'), `تم حفظ زمن التأخير: ${newDelay} ثواني.`, 'success');
            console.log(`Scan delay saved: ${newDelay} seconds.`); // Debugging
        } else {
            alert("زمن التأخير يجب أن يكون بين 1 و 60 ثانية.");
            scanDelayInputEl.value = config.scanDelay; // Revert to saved value
            console.warn(`Invalid scan delay value entered: ${scanDelayInputEl.value}. Reverted to ${config.scanDelay}`); // Debugging
        }
        setTimeout(() => hideStatus(getEl('generalStatus')), 3000);
    }

    // --- إدارة الزبائن ---
    function loadCustomers() {
        console.log("Loading customers..."); // Debugging
        try {
            customers = JSON.parse(localStorage.getItem(CUSTOMERS_KEY)) || {};
             // Ensure customers is an object
            if (typeof customers !== 'object' || customers === null) {
                console.warn("Loaded customers data is not an object, resetting."); // Debugging
                customers = {};
            }
             console.log("Customers loaded from localStorage.", customers); // Debugging
        } catch (e) {
            console.error(`Error loading customers (${CUSTOMERS_KEY}):`, e);
            customers = {}; // Reset if loading fails
             console.log("Customers load failed, resetting.", customers); // Debugging
        }
    }

    function saveCustomers() {
        localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customers));
        console.log("Customers saved to localStorage.", customers); // Debugging
    }

    function updateCustomerData(name, phone) {
        if (!name || typeof name !== 'string' || name.trim() === '') {
            console.warn("Invalid customer name provided for update.", name); // Debugging
            return; // Basic validation
        }
        const timestamp = new Date().toISOString();
        const customerKey = name.trim(); // Use trimmed name as key

        if (customers[customerKey]) {
            customers[customerKey].lastActivity = timestamp;
            customers[customerKey].operationCount = (customers[customerKey].operationCount || 0) + 1;
            // Update phone only if a valid phone string is provided
            if(phone !== undefined && phone !== null && typeof phone === 'string') {
                 customers[customerKey].phone = phone.trim();
            }
            console.log(`Customer ${customerKey} updated.`, customers[customerKey]); // Debugging
        } else {
            // Add new customer
            customers[customerKey] = {
                phone: (phone !== undefined && phone !== null && typeof phone === 'string') ? phone.trim() : '',
                lastActivity: timestamp,
                operationCount: 1
            };
             console.log(`New customer ${customerKey} added.`, customers[customerKey]); // Debugging
        }
        saveCustomers();
    }


    function displayCustomerList() {
        const customerListUl = getEl('customerList');
        if (!customerListUl) {
             console.warn("Customer list element #customerList not found. Cannot display list."); // Debugging
             return; // Check if element exists
        }
         console.log("Displaying customer list..."); // Debugging

        customerListUl.innerHTML = '';
        const customerArray = Object.entries(customers).map(([name, data]) => ({ name, ...data }));

        if (customerArray.length === 0) {
            customerListUl.innerHTML = '<li><i>لا يوجد زبائن مسجلون بعد.</i></li>';
             console.log("Customer list is empty."); // Debugging
            return;
        }

        // Sort by last activity descending
        customerArray.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

        customerArray.forEach(cust => {
            const li = document.createElement('li');
            li.classList.add('customer-item'); // Add class for styling
            li.innerHTML = `${cust.name} <span>(${cust.operationCount} عمليات)</span>`;
            li.dataset.name = cust.name;
            li.dataset.phone = cust.phone || ''; // Ensure phone data attribute exists
            li.addEventListener('click', () => {
                const customerNameInput = getEl('customerName');
                const customerPhoneInput = getEl('customerPhone');
                 if(customerNameInput) customerNameInput.value = cust.name;
                 if(customerPhoneInput) customerPhoneInput.value = cust.phone || '';
                 console.log(`Customer ${cust.name} selected.`); // Debugging
            });
            customerListUl.appendChild(li);
        });
         console.log(`Customer list displayed. Total customers: ${customerArray.length}`); // Debugging
    }

    // --- إدارة المخزون والسجل ---
    function loadInventory() {
        console.log("Loading inventory..."); // Debugging
         try {
             const si = localStorage.getItem(INVENTORY_KEY);
             const pi = si ? JSON.parse(si) : {};
             // Ensure inventory keys exist and are numbers
             inventory = {
                 A: parseInt(pi.A) || 0,
                 B: parseInt(pi.B) || 0,
                 C: parseInt(pi.C) || 0,
                 D: parseInt(pi.D) || 0
             };
              console.log("Inventory loaded from localStorage.", inventory); // Debugging
         } catch(e) {
             console.error(`Error loading inventory (${INVENTORY_KEY}):`, e);
             inventory = { A: 0, B: 0, C: 0, D: 0 }; // Reset if loading fails
             console.log("Inventory load failed, resetting.", inventory); // Debugging
         }
    }

    function saveInventory() {
        localStorage.setItem(INVENTORY_KEY, JSON.stringify(inventory));
        updateInventorySummary();
        console.log("Inventory saved to localStorage.", inventory); // Debugging
    }

    function loadHistory() {
        console.log("Loading history..."); // Debugging
        try {
            const sh = localStorage.getItem(HISTORY_KEY);
            operationsHistory = sh ? JSON.parse(sh) : [];
            // Ensure operationsHistory is an array
            if (!Array.isArray(operationsHistory)) {
                console.warn("Loaded history data is not an array, resetting."); // Debugging
                operationsHistory = [];
            }
            // Update lastOpNumber based on loaded history if it's higher
            if (operationsHistory.length > 0) {
                // Filter out operations with invalid or missing operationNumber before finding max
                const validOpNumbers = operationsHistory
                    .map(op => parseInt(op.operationNumber))
                    .filter(num => !isNaN(num) && num >= 0); // Ensure it's a non-negative number

                const maxOp = validOpNumbers.length > 0 ? Math.max(...validOpNumbers) : 0;

                // Only update if the max found in history is greater than current config
                if (config.lastOpNumber < maxOp) {
                    config.lastOpNumber = maxOp;
                    // No need to save config here, saveConfig is called elsewhere after updates
                    console.log("Adjusted lastOpNumber based on history:", config.lastOpNumber); // Debugging
                }
            } else {
                // If history is empty, explicitly set lastOpNumber to 0
                 config.lastOpNumber = 0;
                 console.log("History is empty, lastOpNumber set to 0."); // Debugging
            }
            console.log("History loaded. Total operations:", operationsHistory.length); // Debugging
             console.log("Current lastOpNumber in config:", config.lastOpNumber); // Debugging

        } catch(e) {
            console.error(`Error loading history (${HISTORY_KEY}):`, e);
            operationsHistory = []; // Reset if loading fails
             config.lastOpNumber = 0; // Also reset op number if history load fails
             console.log("History load failed, resetting.", operationsHistory); // Debugging
        }
         // The config.lastOpNumber might have been updated, save it later if needed
    }


    function saveHistory() {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(operationsHistory));
         console.log("History saved to localStorage. Total operations:", operationsHistory.length); // Debugging
    }

    function addOperationToHistory(operationData) {
         // Validate operationData before adding
         if (!operationData || typeof operationData !== 'object' || !operationData.type || !operationData.timestamp) {
             console.error("Invalid operation data provided to addOperationToHistory", operationData); // Debugging
             return;
         }
        operationsHistory.unshift(operationData); // Add to the beginning
        saveHistory();
        console.log("Operation added to history:", operationData); // Debugging
    }

    function updateInventorySummary() {
        const invSummaryAE = getEl('invSummaryA');
        const invSummaryBE = getEl('invSummaryB');
        const invSummaryCE = getEl('invSummaryC');
        const invSummaryDE = getEl('invSummaryD');

        if (invSummaryAE) invSummaryAE.textContent = inventory.A; else console.warn("#invSummaryA not found.");
        if (invSummaryBE) invSummaryBE.textContent = inventory.B; else console.warn("#invSummaryB not found.");
        if (invSummaryCE) invSummaryCE.textContent = inventory.C; else console.warn("#invSummaryC not found.");
        if (invSummaryDE) invSummaryDE.textContent = inventory.D; else console.warn("#invSummaryD not found.");

        console.log("Inventory summary updated:", inventory); // Debugging
    }

    // This function is called when input operation is completed and saved
    function increaseInventory(itemType) {
         if (inventory.hasOwnProperty(itemType)) {
             // Inventory increase is handled when completing the input operation
             // This function might not be directly used anymore for incremental increases on scan
             console.warn(`IncreaseInventory called for ${itemType}, but should happen on operation completion.`); // Debugging
         } else {
              console.warn(`Attempted to increase inventory for unknown type: ${itemType}`); // Debugging
         }

    }

    function decreaseInventory(itemsObject) {
         if (typeof itemsObject !== 'object') {
             console.error("Invalid itemsObject provided to decreaseInventory", itemsObject); // Debugging
             return;
         }
         console.log("Decreasing inventory with:", itemsObject); // Debugging
        for (const type in itemsObject) {
            if (itemsObject.hasOwnProperty(type) && inventory.hasOwnProperty(type)) {
                const quantityToDecrease = parseInt(itemsObject[type]) || 0;
                if (quantityToDecrease > 0) {
                     inventory[type] = Math.max(0, (inventory[type] || 0) - quantityToDecrease);
                     console.log(`Decreased inventory for ${type} by ${quantityToDecrease}. Current: ${inventory[type]}`); // Debugging
                }
            }
        }
        saveInventory();
    }


    function displayInventoryInForm() {
        const stockAE = getEl('stockA');
        const stockBE = getEl('stockB');
        const stockCE = getEl('stockC');
        const stockDE = getEl('stockD');

        if (stockAE) stockAE.textContent = inventory.A; else console.warn("#stockA not found.");
        if (stockBE) stockBE.textContent = inventory.B; else console.warn("#stockB not found.");
        if (stockCE) stockCE.textContent = inventory.C; else console.warn("#stockC not found.");
        if (stockDE) stockDE.textContent = inventory.D; else console.warn("#stockD not found.");
         console.log("Inventory displayed in form:", inventory); // Debugging
    }

    // --- وظائف مساعدة ---
    function showScreen(screenToShow) {
        Object.values(screens).forEach(s => {
            if (s) s.classList.remove('active');
        });
        if (screenToShow) {
            screenToShow.classList.add('active');
            console.log(`Showing screen: ${screenToShow.id}`); // Debugging
            if (screenToShow === screens.welcome) {
                updateInventorySummary();
                // Ensure general status is hidden on welcome screen
                 hideStatus(getEl('generalStatus'));
            } else {
                 // Hide general status on other screens unless specifically needed
                 hideStatus(getEl('generalStatus'));
            }
             // Scroll to top of the screen
             window.scrollTo(0, 0);
        } else {
             console.error("Attempted to show a null screen."); // Debugging
        }
    }

    function showStatus(element, message, type = 'info') {
        if (element) {
            element.textContent = message;
            // Reset classes first
            element.className = 'status-message small';
            // Add type class and make visible
            element.classList.add(type);
            element.style.display = 'block';
            console.log(`Status on ${element.id || 'element'}: ${message} (${type})`); // Debugging
        } else {
            console.warn(`Attempted to show status on non-existent element with message: "${message}"`); // Debugging
        }
    }

    function hideStatus(element) {
        if (element) {
             element.style.display = 'none';
             console.log(`Status on ${element.id || 'element'} hidden.`); // Debugging
        }
    }

    function resetCurrentOperation() {
        console.log("Resetting current operation..."); // Debugging
        currentStep = 1;
        currentOperationType = null;
        currentOperationData = {};
        currentScannedItems = []; // Clear scanned items for new operation

        // Reset form elements
        const operationFormEl = getEl('operationForm');
        if (operationFormEl) operationFormEl.reset();

        // Reset validation errors
        const actionTypeErrorEl = getEl('actionTypeError');
        const outputErrorEl = getEl('outputError');
        const customerNameErrorEl = getEl('customerNameError'); // أضف هذا العنصر
        if(actionTypeErrorEl) actionTypeErrorEl.textContent = '';
        if(outputErrorEl) outputErrorEl.textContent = '';
        if(customerNameErrorEl) customerNameErrorEl.textContent = ''; // مسح خطأ الاسم

        // Hide status messages specific to operations
        hideStatus(getEl('scanStatus'));
        hideStatus(getEl('outputSendStatus'));

        // Reset customer form highlights
         const customerNameInput = getEl('customerName');
         if(customerNameInput) customerNameInput.style.borderColor = '';

         // Reset output quantity inputs and total
         resetOutputQuantities();

         // Reset scanned items display
         updateScannedItemsDisplay(); // This also clears the list element

         // Ensure form steps are reset visually and first step is active
        formSteps.forEach(step => step.classList.remove('active-step'));
        const firstStep = formSteps.find(step => parseInt(step.dataset.step) === 1);
        if(firstStep) firstStep.classList.add('active-step');

        // Reset radio button selection visual cue
        const radioLabels = screens.operation.querySelectorAll('.radio-group-horizontal label');
        radioLabels.forEach(label => label.classList.remove('selected'));


        console.log("Current operation reset complete."); // Debugging
    }

    function generateUniqueId() {
        return `op_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }

    // --- وظائف كلمة المرور (مع استخدام المودال بدلاً من prompt) ---
    // Get password modal elements
    const passwordOverlay = getEl('passwordPromptOverlay');
    const passwordInput = getEl('passwordInput');
    const submitPasswordBtn = getEl('submitPasswordBtn');
    const passwordError = getEl('passwordError');
    const backToWelcomeFromPwd = getEl('backToWelcomeFromPwd');

    let passwordResolve = null; // Promise resolve function

    // This function is still needed for Change Password and Delete History features
    function promptForPasswordModal(message = "الرجاء إدخال كلمة المرور:") {
        console.log("Attempting to show password modal..."); // Debugging
        // Ensure modal elements exist before proceeding
        if (!passwordOverlay || !passwordInput || !submitPasswordBtn || !backToWelcomeFromPwd) {
             console.error("Password modal elements not found! Cannot display password prompt."); // Debugging
             alert("حدث خطأ في عرض نافذة كلمة المرور.");
             return Promise.resolve(null); // Return a resolved promise with null
        }

        return new Promise((resolve) => {
            passwordResolve = resolve; // Store the resolve function

            const messageElement = passwordOverlay.querySelector('p');
             if(messageElement) messageElement.textContent = message; // Set message text
             else console.warn("Password modal message element not found."); // Debugging

            passwordInput.value = ''; // Clear input field
            if(passwordError) passwordError.textContent = ''; // Clear previous errors
             else console.warn("Password error element not found."); // Debugging

            passwordOverlay.classList.add('active'); // Show the modal
            passwordInput.focus(); // Focus the input field

            console.log("Password modal displayed. Waiting for user input."); // Debugging
        });
    }

    // This function is still needed for Change Password and Delete History features
    function closePasswordPrompt(value) {
        console.log(`Closing password modal with value: ${value === null ? 'null (cancelled)' : 'password provided'}`); // Debugging
        if (passwordOverlay) passwordOverlay.classList.remove('active'); // Hide the modal
        else console.warn("Password overlay element not found during close."); // Debugging

        if (passwordResolve) {
            passwordResolve(value); // Resolve the promise with the provided value (password or null)
            passwordResolve = null; // Reset the resolve function
            console.log("Password promise resolved."); // Debugging
        } else {
            console.warn("Password modal closed, but no active promise to resolve."); // Debugging
        }
    }

    // This function is still needed for Change Password and Delete History features
    function checkPassword(enteredPassword) {
         // Retrieve the password from the loaded config
         const storedPassword = config.password;
         const isCorrect = enteredPassword === storedPassword;

         console.log(`Checking password: Entered="${enteredPassword}", Stored="${storedPassword}", Match=${isCorrect}`); // Debugging

         // Clear password input value after check for security (optional here, happens on close)
         // if(passwordInput) passwordInput.value = '';

         // Provide feedback on the modal itself (optional, but good practice)
         if(passwordError) {
             if (!isCorrect) {
                 passwordError.textContent = "كلمة المرور غير صحيحة";
                 console.log("Password check failed, showing error on modal."); // Debugging
             } else {
                 passwordError.textContent = ""; // Clear error on success
                 console.log("Password check successful, clearing modal error."); // Debugging
             }
         } else {
             console.warn("Password error element not found during check."); // Debugging
         }

         return isCorrect;
    }


    async function handleChangePassword() {
         console.log("Change password initiated."); // Debugging
         // Ensure modal elements exist
         if (!passwordOverlay || !passwordInput || !submitPasswordBtn || !backToWelcomeFromPwd) {
             alert("لا يمكن تغيير كلمة المرور، عناصر الواجهة غير موجودة.");
             console.error("Missing password modal elements for change password."); // Debugging
             return;
         }

        const oldPassword = await promptForPasswordModal("لتغيير كلمة المرور، أدخل كلمة المرور الحالية:");
        if (oldPassword === null) {
            console.log("Change password cancelled at old password prompt."); // Debugging
            return; // User cancelled from the first prompt
        }

        if (!checkPassword(oldPassword)) {
            // The checkPassword function now shows the error on the modal
            console.warn("Incorrect old password provided for change."); // Debugging
            // We don't close the modal here, the user needs to see the error and try again or cancel
            // The closePasswordPrompt is called by the modal's buttons or external click (if implemented)
            return; // Stop the change process
        }
         console.log("Old password correct."); // Debugging
         // Close the modal after successful old password check before prompting for new
         closePasswordPrompt(true); // Close with a truthy value to indicate success

        const newPassword = await promptForPasswordModal("أدخل كلمة المرور الجديدة:");
        if (newPassword === null) {
             console.log("Change password cancelled at new password prompt."); // Debugging
             return; // User cancelled from the second prompt
        }
        if (newPassword.trim() === "") {
            alert("كلمة المرور الجديدة لا يمكن أن تكون فارغة.");
            console.warn("New password cannot be empty."); // Debugging
            return;
        }

        const confirmPassword = await promptForPasswordModal("أعد إدخال كلمة المرور الجديدة للتأكيد:");
        if (confirmPassword === null) {
             console.log("Change password cancelled at confirm password prompt."); // Debugging
             return; // User cancelled from the third prompt
        }

        if (newPassword === confirmPassword) {
            savePassword(newPassword); // This also calls saveConfig() and alerts success
             console.log("New password confirmed and saved."); // Debugging
             // The savePassword function already shows an alert.
             // closePasswordPrompt(true); // Close the modal after saving
        } else {
            alert("كلمتا المرور الجديدتان غير متطابقتين.");
            console.warn("New passwords do not match."); // Debugging
             // closePasswordPrompt(false); // Close with a falsy value
        }
    }

    async function handleDeleteHistory() {
         console.log("Delete history initiated."); // Debugging
         // Ensure modal elements exist
         if (!passwordOverlay || !passwordInput || !submitPasswordBtn || !backToWelcomeFromPwd) {
             alert("لا يمكن حذف السجل، عناصر الواجهة غير موجودة.");
             console.error("Missing password modal elements for delete history."); // Debugging
             return;
         }

         if (confirm("تحذير: هل أنت متأكد من حذف جميع السجلات؟ لا يمكن التراجع.")) {
             const enteredPassword = await promptForPasswordModal("لحذف السجل، أدخل كلمة المرور:");
             if (enteredPassword === null) {
                  console.log("Delete history cancelled at password prompt."); // Debugging
                  return; // User cancelled
             }

             if (checkPassword(enteredPassword)) {
                 console.log("Password correct. Deleting history."); // Debugging
                 // Close the modal immediately after correct password
                 closePasswordPrompt(true);

                 operationsHistory = []; // Clear the history array
                 customers = {}; // Clear customers (optional, based on your design)
                 config.lastOpNumber = 0; // Reset operation number
                 saveHistory(); // Save empty history
                 saveCustomers(); // Save empty customers
                 saveConfig(); // Save the reset lastOpNumber and config

                 // Update the display to show empty history
                 displayHistory();

                 alert("تم حذف جميع السجلات بنجاح.");
                 console.log("History deleted successfully."); // Debugging

                  // Hide history content and show welcome screen after deletion
                 const historyContentEl = getEl('historyContent');
                 if(historyContentEl) historyContentEl.style.display = 'none';
                  else console.warn("#historyContent not found after deletion."); // Debugging
                 showScreen(screens.welcome);

             } else {
                 // Error message is shown by checkPassword on the modal
                 console.warn("Incorrect password provided for delete history."); // Debugging
                 // Don't close modal here, let user retry or cancel
             }
         } else {
             console.log("Delete history cancelled by user confirmation."); // Debugging
         }
    }


    // --- وظيفة إظهار الخطوات (مع تحديث رقم العملية) ---
    function showStep(stepNumber) {
        console.log(`Attempting to show step: ${stepNumber}`); // Debugging
        formSteps.forEach(step => step.classList.remove('active-step'));

        // Find the step element based on number and current operation type
        let stepToShow = formSteps.find(step => {
            const stepNum = parseInt(step.dataset.step);
            const stepType = step.dataset.type;

            // Check if step number matches
            if (stepNum !== stepNumber) return false;

            // If step has a type, check if it matches current operation type
            // This is crucial for distinguishing between input and output step 2
            if (stepType && stepType !== currentOperationType) return false;
            // If step has no type, it's a generic step (like step 1)
            if (!stepType && stepNumber !== 1) return false; // Only step 1 is generic

            // Otherwise, it's a match
            return true;
        });


        if (stepToShow) {
            stepToShow.classList.add('active-step');
            currentStep = stepNumber;
            console.log(`Showing form step: ${stepNumber} (Type: ${currentOperationType || 'None'})`); // Debugging

            if (stepNumber === 1) {
                const opNumDisplay = getEl('operationNumberDisplay');
                if(opNumDisplay) opNumDisplay.value = config.lastOpNumber + 1; // عرض الرقم التالي
                else console.warn("#operationNumberDisplay not found."); // Debugging
                displayCustomerList();
                 // Ensure validation errors are hidden when returning to step 1
                 hideStatus(getEl('actionTypeError'));
                 const customerNameErrorEl = getEl('customerNameError');
                 if(customerNameErrorEl) customerNameErrorEl.textContent = '';
            }
            if (stepNumber === 2 && currentOperationType === 'input') {
                const qrInput = getEl('qrInput');
                 if(qrInput) {
                     qrInput.value = '';
                     qrInput.disabled = false;
                     qrInput.focus();
                 } else {
                      console.error("#qrInput not found for input step."); // Debugging
                 }
                 isScanningPaused = false;
                 clearTimeout(scanPauseTimeoutId);
                 clearInterval(scanPauseIntervalId);
                 updateScannedItemsDisplay(); // Ensure display is clear for new input op
                 hideStatus(getEl('scanStatus')); // Hide status from previous scans

            }
            if (stepNumber === 2 && currentOperationType === 'output') {
                 displayInventoryInForm(); // Show current stock levels
                 resetOutputQuantities(); // Clear previous quantities
                 hideStatus(getEl('outputError')); // Clear previous errors
                 loadAndDisplayLastInputInfo(); // Attempt to load and show last input info
                 // Ensure the send button is enabled initially
                  const sendOutputBtn = getEl('sendOutputBtn');
                 if(sendOutputBtn) {
                      sendOutputBtn.disabled = false;
                      sendOutputBtn.innerHTML = '<i class="fas fa-paper-plane icon"></i> إرسال الطلب للروبوت';
                 } else {
                      console.error("#sendOutputBtn not found for output step."); // Debugging
                 }
                 // Add event listeners to quantity inputs to update total
                 const qInputs = getQuantityInputs();
                 for(const type in qInputs) {
                     if(qInputs[type]) {
                         // Remove existing listeners first to prevent duplicates
                         qInputs[type].removeEventListener('input', updateTotalRequested);
                         // Add the listener
                         qInputs[type].addEventListener('input', updateTotalRequested);
                     }
                 }
                 updateTotalRequested(); // Calculate initial total on step load
            }
        } else {
            console.error("Step element not found for step:", stepNumber, "type:", currentOperationType); // Debugging
            showScreen(screens.welcome); // Fallback to welcome screen
        }
    }


    // --- وظيفة الإرسال للـ ESP (مُراجعة للتعامل مع الرد "OK") ---
    async function sendDataToESP(data, type) {
        // استخدم ESP_BASE_URL الذي تم تحديثه عند تحميل/حفظ الإعدادات
        let endpoint = ESP_BASE_URL;
        let body = null;
        let headers = {};
        let statusElement = getEl('robotCommandStatus'); // Default status element

        if (type === 'input') {
            endpoint += '/input';
            body = String(data);
            headers = {'Content-Type':'text/plain'};
            statusElement = getEl('scanStatus'); // Specific status for input
        } else if (type === 'output') {
            endpoint += '/output';
            // Data for output is an object, stringify it
            body = JSON.stringify(data);
            headers = {'Content-Type':'application/json'}; // Correct content type for JSON
            statusElement = getEl('outputSendStatus'); // Specific status for output
        } else if (type === 'command') {
            endpoint += '/command';
            body = String(data);
            headers = {'Content-Type':'text/plain'};
            statusElement = getEl('robotCommandStatus'); // Specific status for commands
        } else {
            console.error("Unknown type for ESP send:", type); // Debugging
            if(statusElement) showStatus(statusElement, "خطأ داخلي: نوع أمر غير معروف.", 'error');
            return false;
        }

        console.log(`Sending ${type} to ${endpoint}:`, body); // Debugging
        if(statusElement) showStatus(statusElement, `جاري إرسال الأمر...`, 'info'); // Generic sending message
        else console.warn("Status element not found for sendDataToESP."); // Debugging


        try {
            const controller = new AbortController();
            // Increased timeout slightly to account for potential network delays or slow ESP response
            const timeoutId = setTimeout(() => {
                 controller.abort();
                 console.warn("ESP request timed out."); // Debugging
            }, 15000); // 15 seconds timeout

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: headers,
                body: body,
                signal: controller.signal // Link controller to fetch
            });

            clearTimeout(timeoutId); // Clear timeout if fetch completes


            if (response.ok) {
                const responseText = await response.text();
                console.log("Response from ESP:", responseText); // Debugging

                // --- التحقق من رد ESP ---
                // Check for "OK" case-insensitively and trimmed
                if (responseText.trim().toUpperCase().includes("OK")) {
                    console.log("ESP confirmation 'OK' received."); // Debugging
                    if(statusElement) showStatus(statusElement, `تم الاستلام من الروبوت بنجاح.`, 'success'); // More specific success
                    // Keep success message for a while, except for commands
                    if (type !== 'command') {
                        setTimeout(() => hideStatus(statusElement), 3000);
                    } else {
                         setTimeout(() => hideStatus(statusElement), 1500); // Hide faster for commands
                    }
                    return true; // نجاح مؤكد

                } else {
                    console.warn("Received OK status, but unexpected response content."); // Debugging
                    if(statusElement) showStatus(statusElement, `تم الاستلام برد غير متوقع: "${responseText.substring(0, 50)}..."`, 'warning');
                     setTimeout(() => hideStatus(statusElement), 4000);
                    return false; // Consider it a failure due to unexpected response
                }
            } else {
                const errorText = await response.text();
                console.error(`Workspace Request Failed! Status: ${response.status}`, errorText); // Debugging
                if(statusElement) showStatus(statusElement, `فشل ${response.status}: ${errorText || 'لا يوجد رد'}`, 'error');
                 setTimeout(() => hideStatus(statusElement), 5000);
                return false; // Request failed (e.g., 404, 500)
            }
        } catch (error) {
            console.error("ESP Send Error:", error); // Debugging
            let errorMessage = "فشل الاتصال بالروبوت";
            if (error.name === 'AbortError') {
                errorMessage = "انتهى وقت الاتصال بالروبوت (Timeout)";
            } else {
                errorMessage += `: ${error.message}`;
            }
            if(statusElement) showStatus(statusElement, errorMessage, 'error');
             setTimeout(() => hideStatus(statusElement), 5000);
            return false; // Connection or timeout error
        }
    }


    // --- وظائف الإدخال (مع التأخير والتحقق من المخزون) ---
    let inputTimeout = null; // تعريف المؤقت for handleQrScan input event


    async function handleQrScan() {
        if (isScanningPaused) {
            console.log("Scanning paused, ignoring input."); // Debugging
            return;
        }

        const qrInput = getEl('qrInput');
        const scanStatus = getEl('scanStatus');
        if (!qrInput || !scanStatus) {
            console.error("QR Input or Scan Status element not found for handleQrScan."); // Debugging
            return; // Ensure elements exist
        }

        const qrData = qrInput.value.trim().toUpperCase();
        qrInput.value = ''; // Clear input immediately
        // qrInput.focus(); // Keep focus for next scan - Handled by startScanDelay/failure

        if (qrData === '') {
             // Ignore empty input
             qrInput.focus(); // Keep focus if input is empty
             return;
        }

        console.log(`Processing QR scan: ${qrData}`); // Debugging

        // --- MODIFIED: Check inventory capacity before processing scan ---
        if (['A', 'B', 'C', 'D'].includes(qrData)) {
            const currentInventoryCount = inventory[qrData] || 0;
            if (currentInventoryCount >= MAX_STOCK_PER_TYPE) {
                showStatus(scanStatus, `المخزون ممتلئ للصنف ${qrData} (الحد الأقصى ${MAX_STOCK_PER_TYPE}). لا يمكن الإضافة.`, 'error');
                setTimeout(() => hideStatus(scanStatus), 4000);
                qrInput.focus(); // Keep focus
                console.log(`Inventory full for ${qrData} (${currentInventoryCount}/${MAX_STOCK_PER_TYPE}). Scan rejected.`); // Debugging
                return; // Stop here if inventory is full
            }
            console.log(`Inventory check passed for ${qrData} (${currentInventoryCount}/${MAX_STOCK_PER_TYPE}). Proceeding.`); // Debugging


            // If inventory is not full, proceed with sending and adding
            qrInput.disabled = true; // Disable input during sending/delay
            isScanningPaused = true;
            showStatus(scanStatus, `تم التعرف [${qrData}]. جاري الإرسال...`, 'info');
            console.log(`Valid QR scanned: ${qrData}. Sending to ESP.`); // Debugging

            const success = await sendDataToESP(qrData, 'input');

            if (success) { // Successful sending and confirmed reception from ESP
                const newItem = { type: qrData, scanTime: new Date().toISOString() };
                currentScannedItems.push(newItem);
                updateScannedItemsDisplay();
                console.log(`Item ${qrData} added to scanned items.`); // Debugging

                // Start the delay after success
                startScanDelay(qrData);

            } else { // Sending or confirmation failed
                // Error status already shown by sendDataToESP
                qrInput.disabled = false; // Re-enable input on failure
                isScanningPaused = false;
                qrInput.focus(); // Keep focus
                console.warn(`Failed to send or confirm ${qrData} scan.`); // Debugging
            }
        } else {
             // Handle invalid scan data
            showStatus(scanStatus, `رمز غير صالح (${qrData}).`, 'error');
            setTimeout(() => hideStatus(scanStatus), 3000);
            qrInput.focus(); // Keep focus
            console.warn(`Invalid QR scanned: ${qrData}`); // Debugging
        }
    }


    function startScanDelay(itemType) {
        const delaySeconds = config.scanDelay || 10;
        let countdown = delaySeconds;
        const qrInput = getEl('qrInput');
        const scanStatus = getEl('scanStatus');
        if (!qrInput || !scanStatus) {
            console.error("QR Input or Scan Status element not found for startScanDelay."); // Debugging
            return; // Ensure elements exist
        }

        qrInput.disabled = true; // تأكيد التعطيل
        isScanningPaused = true;
        showStatus(scanStatus, `تم استلام [${itemType}]. انتظر ${countdown} ثواني...`, 'warning');
        console.log(`Starting scan delay (${delaySeconds}s) for ${itemType}.`); // Debugging

        // مسح المؤقتات القديمة إذا كانت موجودة
        clearTimeout(scanPauseTimeoutId);
        clearInterval(scanPauseIntervalId);

        scanPauseIntervalId = setInterval(() => {
            countdown--;
            if (countdown >= 0) { // Include 0 in countdown display
                showStatus(scanStatus, `تم استلام [${itemType}]. انتظر ${countdown} ثواني...`, 'warning');
            }
        }, 1000);

         scanPauseTimeoutId = setTimeout(() => {
             clearInterval(scanPauseIntervalId); // التأكد من إيقاف العد التنازلي
             qrInput.disabled = false;
             isScanningPaused = false;
             qrInput.focus(); // Focus after delay
             hideStatus(scanStatus);
             console.log("Scan delay finished. Input re-enabled."); // Debugging
             // Optional: show a ready message briefly
             // showStatus(scanStatus, 'جاهز للمسح التالي.', 'info');
             // setTimeout(()=> hideStatus(scanStatus), 1000);
         }, delaySeconds * 1000);
    }


    function updateScannedItemsDisplay() {
         const scannedItemsList = getEl('scannedItemsList');
         const scannedCount = getEl('scannedCount');
         if (!scannedItemsList || !scannedCount) {
             console.warn("Scanned items display elements not found. Cannot update display."); // Debugging
             return; // Ensure elements exist
         }

         scannedItemsList.innerHTML = ''; // Clear previous content
         if (currentScannedItems.length === 0) {
             scannedItemsList.innerHTML = '<li><i>لم يتم مسح أي أصناف بعد.</i></li>';
              console.log("No scanned items, displaying empty message."); // Debugging
         } else {
             // Display latest items first
             [...currentScannedItems].reverse().forEach(item => {
                 const li = document.createElement('li');
                 li.classList.add('scanned-item'); // Add class for styling
                 li.innerHTML = `<span class="item-type-tag item-${item.type ? item.type.toLowerCase() : 'unknown'}">${item.type || 'غير معروف'}</span> <span class="scan-time">${item.scanTime ? new Date(item.scanTime).toLocaleTimeString('ar-EG') : '-'}</span>`;
                 scannedItemsList.appendChild(li);
             });
         }
         scannedCount.textContent = currentScannedItems.length;
         console.log(`Scanned items display updated. Count: ${currentScannedItems.length}`); // Debugging
    }


    function completeInputOperation() {
        console.log("Completing input operation..."); // Debugging
        if (currentScannedItems.length === 0) {
            alert("لم يتم مسح أي بضاعة لحفظها!");
            console.warn("Attempted to complete input operation with no scanned items."); // Debugging
            return;
        }

        // Increment operation number ONLY on successful completion
        // Get the next operation number
        const nextOpNumber = config.lastOpNumber + 1;


        const operation = {
            operationNumber: nextOpNumber, // Use the incremented number
            id: generateUniqueId(),
            type: 'input',
            customerName: currentOperationData.customerName || 'غير محدد', // Add fallback
            customerPhone: currentOperationData.customerPhone || '',
            timestamp: new Date().toISOString(),
            items: [...currentScannedItems] // Save a copy of scanned items
        };

        addOperationToHistory(operation); // This also saves history and updates customer data implicitly

        // --- زيادة المخزون الفعلي هنا عند الحفظ ---
        currentScannedItems.forEach(item => {
            if (item.type && inventory.hasOwnProperty(item.type)) { // Check item type validity
                // Only increase if it won't exceed MAX_STOCK_PER_TYPE
                if ((inventory[item.type] || 0) < MAX_STOCK_PER_TYPE) {
                     inventory[item.type] = (inventory[item.type] || 0) + 1;
                     console.log(`Increasing inventory for ${item.type} on completion.`); // Debugging
                } else {
                     console.warn(`Inventory for ${item.type} already at max on completion, not increasing.`); // Debugging
                }
            } else {
                 console.warn("Skipping inventory increase for invalid item type:", item.type); // Debugging
            }
        });
        saveInventory(); // Save the updated inventory to localStorage

        // Update config with the new last operation number and save
        config.lastOpNumber = nextOpNumber; // Update the config object first
        updateCustomerData(operation.customerName, operation.customerPhone); // Update customer last activity/count (this also saves customers)
        saveConfig(); // Save the updated config (which includes lastOpNumber)


        showStatus(getEl('generalStatus'), `تم حفظ عملية الإدخال #${operation.operationNumber} (${currentScannedItems.length} صنف).`, 'success');
        console.log(`Input operation #${operation.operationNumber} completed and saved.`); // Debugging

        // Delay before returning to welcome screen
        setTimeout(() => {
            resetCurrentOperation();
            showScreen(screens.welcome);
            hideStatus(getEl('generalStatus')); // Ensure status is hidden on welcome
        }, 3000); // Shortened delay slightly
    }


    // --- وظائف الإخراج (مع إضافة مساعد آخر إدخال) ---
    function resetOutputQuantities() {
        console.log("Resetting output quantities."); // Debugging
        const qInputs = getQuantityInputs();
        // Check if any input exists before trying to reset values
        if(qInputs.A || qInputs.B || qInputs.C || qInputs.D) {
             Object.values(qInputs).forEach(i => { if(i) i.value = 0; }); // Ensure inputs exist before resetting value
        } else {
             console.warn("Quantity inputs not found for resetOutputQuantities."); // Debugging
        }


        const totalRequestedEl = getEl('totalRequested');
        if(totalRequestedEl) totalRequestedEl.textContent = 0;
        else console.warn("#totalRequested not found for reset."); // Debugging

        // Clear output error status
        hideStatus(getEl('outputError'));
    }

    function getQuantityInputs() {
         // Get input elements and return an object, checking for existence
         const inputs = {
             A: getEl('quantityA'),
             B: getEl('quantityB'),
             C: getEl('quantityC'),
             D: getEl('quantityD')
         };
         // Optional: Log warnings for missing inputs here if needed frequently
         // for(const type in inputs) { if(!inputs[type]) console.warn(`Quantity input #${type} not found.`); }
         return inputs;
    }

    function updateTotalRequested() {
        let t = 0;
        const qInputs = getQuantityInputs();
         let allInputsExist = true;
         // Check if all quantity inputs exist
         // Note: This check might be too strict if only some types are used.
         // A better check might be to ensure at least one input exists.
         // For now, keeping the check as is, assuming all 4 inputs should be present.
         for(const type in qInputs) {
             if (!qInputs[type]) {
                 allInputsExist = false;
                 console.warn(`Quantity input for type ${type} not found during total calculation.`); // Debugging
                 break;
             }
         }

         if(allInputsExist) {
             Object.values(qInputs).forEach(i => { t += parseInt(i.value) || 0; });
         } else {
              console.error("Cannot calculate total requested, some quantity inputs are missing."); // Debugging
              // Return 0 or handle error appropriately if inputs are critical
              t = 0; // Set total to 0 if inputs are missing
         }


        const totalRequestedEl = getEl('totalRequested');
        if(totalRequestedEl) totalRequestedEl.textContent = t;
        else console.warn("#totalRequested not found for update."); // Debugging


        // Also check the total limit and return if it's exceeded
        // Use MAX_TOTAL_OUTPUT constant
        if (t > MAX_TOTAL_OUTPUT) {
            showStatus(getEl('outputError'), `خطأ: المجموع الكلي (${t}) أكبر من الحد الأقصى (${MAX_TOTAL_OUTPUT}).`, 'error');
            console.warn(`Total requested exceeds limit: ${t}`); // Debugging
            return false; // Indicate total limit exceeded
        } else {
             hideStatus(getEl('outputError')); // Hide total error if within limit
             console.log(`Total requested: ${t} (within limit).`); // Debugging
             return true; // Indicate total is within limit
        }
    }


    // checkAvailabilityAndLimits focuses on individual limits (max 4 per type) and availability
    function checkAvailabilityAndLimits(showErrors = true) {
        let possible = true;
        const qInputs = getQuantityInputs();

         let allInputsExist = true;
         // Check if all quantity inputs exist
         for(const type in qInputs) {
             if (!qInputs[type]) {
                 allInputsExist = false;
                 console.warn(`Quantity input for type ${type} not found during availability check.`); // Debugging
                 break;
             }
         }

         if(!allInputsExist) {
             console.error("Cannot check availability/limits, some quantity inputs are missing."); // Debugging
             if(showErrors) showStatus(getEl('outputError'), "خطأ داخلي: عناصر الكمية مفقودة.", 'error');
             return false; // Cannot proceed if inputs are missing
         }

        // Clear previous errors if showing new ones
        if(showErrors) hideStatus(getEl('outputError'));
        console.log("Checking individual availability and limits..."); // Debugging

        for (const type in qInputs) {
            const requested = parseInt(qInputs[type].value) || 0;
            const available = inventory[type] || 0;


            if (requested < 0) {
                 if(showErrors) showStatus(getEl('outputError'), `خطأ: كمية سالبة لـ ${type}.`, 'error');
                 possible = false;
                 console.warn(`Negative quantity for ${type}: ${requested}`); // Debugging
            }
            // --- MODIFIED: Check individual item quantity limit (max 4 per type) ---
            if (requested > MAX_STOCK_PER_TYPE) { // Use MAX_STOCK_PER_TYPE
                 if(showErrors) showStatus(getEl('outputError'), `خطأ: الكمية المطلوبة لـ ${type} (${requested}) تتجاوز الحد الأقصى (${MAX_STOCK_PER_TYPE}).`, 'error');
                 possible = false;
                 console.warn(`Quantity for ${type} exceeds individual limit (${MAX_STOCK_PER_TYPE}): ${requested}`); // Debugging
            }
            // Check availability in inventory
            if (requested > available) {
                 if(showErrors) showStatus(getEl('outputError'), `خطأ: الكمية المطلوبة لـ ${type} (${requested}) أكبر من المتاح (${available}).`, 'error');
                 possible = false;
                 console.warn(`Quantity for ${type} exceeds available inventory (${available}): ${requested}`); // Debugging
            }
        }

        // Note: The total quantity limit (max 20) is checked in updateTotalRequested.
        // We call both before completing the operation.

        console.log(`Individual availability and limits check result: ${possible}`); // Debugging
        // Return true only if all individual checks passed.
        return possible;
    }


    function updateOutputSummary() {
        console.log("Updating output summary..."); // Debugging
        // Ensure summary elements exist
         const summaryNameOut = getEl('summaryNameOut');
         const summaryPhoneOut = getEl('summaryPhoneOut');
         const ul = getEl('summaryQuantitiesOut');
         if(!summaryNameOut || !summaryPhoneOut || !ul) {
             console.warn("Output summary elements not found."); // Debugging
             return;
         }

        summaryNameOut.textContent = currentOperationData.customerName || '';
        summaryPhoneOut.textContent = currentOperationData.customerPhone || '';
        ul.innerHTML = ''; // Clear previous list items
        let hasItems = false;
        const qInputs = getQuantityInputs();

        if(qInputs.A || qInputs.B || qInputs.C || qInputs.D) { // Check if any quantity inputs exist
             for (const type in qInputs) {
                 // Ensure the input element exists for this type before accessing its value
                 if (qInputs[type]) {
                     const q = parseInt(qInputs[type].value) || 0;
                     if (q > 0) {
                         const li = document.createElement('li');
                         li.innerHTML = `<strong>${type}:</strong> ${q}`;
                         ul.appendChild(li);
                         hasItems = true;
                     }
                 }
             }
        } else {
             console.warn("Quantity inputs not found, cannot build output summary list."); // Debugging
        }

        if (!hasItems) {
            ul.innerHTML = '<li>لم يطلب شيء.</li>';
        }
         console.log("Output summary updated."); // Debugging
    }


    function loadAndDisplayLastInputInfo() {
        console.log("Loading and displaying last input info..."); // Debugging
        const lastInputInfoDiv = getEl('lastInputInfo');
        const fillButton = getEl('fillFromLastInputBtn');
         if (!lastInputInfoDiv || !fillButton) {
             console.warn("Last input info elements not found."); // Debugging
             return; // Ensure elements exist
         }

        lastInputInfoDiv.innerHTML = '<p><i>جاري البحث عن آخر عملية إدخال...</i></p>'; // Initial message
        fillButton.disabled = true; // Disable button until info is loaded
        fillButton.dataset.fillData = ''; // Clear previous data

        // Find the latest input operation from the loaded history
        // Check if history is loaded and is an array before searching
         if (!Array.isArray(operationsHistory) || operationsHistory.length === 0) {
             lastInputInfoDiv.innerHTML = '<p><i>لا توجد عمليات إدخال سابقة في السجل.</i></p>';
             fillButton.disabled = true;
             console.log("No history loaded or history is empty, cannot display last input info."); // Debugging
             return;
         }

         // Find the most recent input operation with items
         // Since history is added using unshift, the first input operation found is the latest
         const lastInputOp = operationsHistory.find(op =>
             op.type === 'input' && op.items && Array.isArray(op.items) && op.items.length > 0
         );


        if (lastInputOp) {
             console.log("Last input operation found:", lastInputOp); // Debugging
             // Calculate counts of item types from scanned items
             const counts = ((lastInputOp.items && Array.isArray(lastInputOp.items)) ? lastInputOp.items : []) // Ensure items is an array
                 .reduce((acc, item) => {
                     if(item && item.type && ['A', 'B', 'C', 'D'].includes(item.type)){ // Only count valid types
                        acc[item.type] = (acc[item.type] || 0) + 1;
                     }
                     return acc;
                 }, {A:0, B:0, C:0, D:0}); // Initialize counts for all types


             let infoHtml = `<p><strong>الزبون:</strong> ${lastInputOp.customerName || '-'}</p>`;
             infoHtml += `<p><strong>التاريخ:</strong> ${lastInputOp.timestamp ? new Date(lastInputOp.timestamp).toLocaleDateString('ar-EG') : '-'}</p>`;
             infoHtml += `<p><strong>الأصناف:</strong> (${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(', ')})</p>`;

             lastInputInfoDiv.innerHTML = infoHtml;
             fillButton.disabled = false;

             // Store the counts object as a string in a data attribute
             fillButton.dataset.fillData = JSON.stringify(counts);
             console.log("Last input info loaded and displayed."); // Debugging

         } else {
             lastInputInfoDiv.innerHTML = '<p><i>لم يتم العثور على عمليات إدخال سابقة تحتوي على أصناف.</i></p>';
             fillButton.disabled = true; // Ensure button is disabled
             fillButton.dataset.fillData = ''; // Clear any previous fill data
             console.log("No previous input operations found with items."); // Debugging
         }
    }


    function populateOutputFromLastInput() {
        console.log("Attempting to populate output from last input."); // Debugging
        const fillButton = getEl('fillFromLastInputBtn');
         if (!fillButton) {
             console.error("Fill from last input button not found."); // Debugging
             return; // Ensure button exists
         }

        const fillDataString = fillButton.dataset.fillData;
        if (!fillDataString) {
            console.warn("No fill data found in data attribute. Button was likely disabled."); // Debugging
            return;
        }

        try {
            const lastInputCounts = JSON.parse(fillDataString);
            console.log("Parsed fill data:", lastInputCounts); // Debugging
            const qInputs = getQuantityInputs();
             let allInputsExist = true;
             for(const type in qInputs) { if (!qInputs[type]) { allInputsExist = false; break; } }

             if(!allInputsExist) { // Exit if inputs don't exist
                 console.error("Quantity inputs not found, cannot populate."); // Debugging
                 alert("عناصر الكمية غير موجودة لملئها.");
                 return;
             }

            let totalAfterFill = 0;
            for (const type in qInputs) {
                 // Ensure the type is valid and exists in counts
                 if (['A', 'B', 'C', 'D'].includes(type) && lastInputCounts.hasOwnProperty(type)) {
                     let requested = parseInt(lastInputCounts[type]) || 0;

                     // Apply restrictions: available inventory and max 4 per type
                     const available = inventory[type] || 0;
                     requested = Math.min(requested, available, MAX_STOCK_PER_TYPE); // Ensure quantity doesn't exceed available or max per type

                     qInputs[type].value = requested;
                     totalAfterFill += requested; // Sum up the quantities that were set
                     console.log(`Set quantity for ${type} to ${requested}`); // Debugging
                 } else {
                     // For types not in lastInputCounts or invalid, set to 0
                     if (qInputs[type]) qInputs[type].value = 0;
                 }
            }

            // Check the total limit after filling and adjust if necessary
            // Use MAX_TOTAL_OUTPUT constant
            if (totalAfterFill > MAX_TOTAL_OUTPUT) {
                 console.warn(`Total quantity after filling (${totalAfterFill}) exceeds max (${MAX_TOTAL_OUTPUT}). Alerting user.`); // Debugging
                 alert(`الكمية الإجمالية بعد الملء التلقائي (${totalAfterFill}) تتجاوز الحد الأقصى (${MAX_TOTAL_OUTPUT}). يرجى التعديل يدوياً.`);
                 // Optional: Consider calling updateTotalRequested() again here to update display and show error
                 // updateTotalRequested();
            }


            // Update total display and check limits after filling
            updateTotalRequested(); // This also checks the total limit again and shows/hides error
            checkAvailabilityAndLimits(); // Check and show individual errors after filling

            console.log("Output quantities populated from last input."); // Debugging

        } catch (e) {
            console.error("Error parsing fill data or populating inputs:", e); // Debugging
            alert("حدث خطأ أثناء محاولة ملء البيانات من آخر عملية إدخال.");
        }
    }


    async function completeOutputOperation() {
        console.log("Completing output operation..."); // Debugging
        // Perform validation before sending
        const isIndividualLimitsValid = checkAvailabilityAndLimits(true); // Checks availability and max 4 per type (show errors)
        const isTotalLimitValid = updateTotalRequested(); // Checks total max 16 (shows error if needed)

        if (!isIndividualLimitsValid || !isTotalLimitValid) {
             // Error messages are shown by the validation functions
             console.warn("Validation failed for output operation. Stopping."); // Debugging
             return; // Stop if validation fails
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
             console.error("Quantity inputs are missing, cannot complete output operation."); // Debugging
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
            console.warn("Attempted to complete output operation with 0 total items."); // Debugging
            return;
        }

        const sendBtn = getEl('sendOutputBtn');
        if (!sendBtn) {
             console.error("Send output button not found."); // Debugging
             return; // Ensure button exists
        }

        // Disable button and show sending status
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin icon"></i> جاري الإرسال...';
        console.log("Attempting to send output command to ESP:", requestedQuantities); // Debugging

        const success = await sendDataToESP(requestedQuantities, 'output');

        if (success) {
            console.log("Output command sent successfully."); // Debugging
            // Increment operation number ONLY on successful sending to robot
            const nextOpNumber = config.lastOpNumber + 1;

            const operation = {
                operationNumber: nextOpNumber, // Use the incremented number
                id: generateUniqueId(),
                type: 'output',
                customerName: currentOperationData.customerName || 'غير محدد', // Add fallback
                customerPhone: currentOperationData.customerPhone || '',
                timestamp: new Date().toISOString(),
                itemsRequested: requestedQuantities // Save the requested quantities
            };

            addOperationToHistory(operation); // This also saves history and updates customer data implicitly
            decreaseInventory(requestedQuantities); // Decrease inventory based on sent quantities

            // Update config with the new last operation number and save
            config.lastOpNumber = nextOpNumber; // Update the config object first
            updateCustomerData(operation.customerName, operation.customerPhone); // Update customer (this also saves customers)
            saveConfig(); // Save the updated config (which includes lastOpNumber)


            showStatus(getEl('generalStatus'), `تم إرسال أمر الإخراج #${operation.operationNumber} وحفظ العملية.`, 'success');
            console.log(`Output operation #${operation.operationNumber} completed and saved.`); // Debugging

            // Delay before returning to welcome screen
            setTimeout(() => {
                resetCurrentOperation();
                showScreen(screens.welcome);
                hideStatus(getEl('generalStatus')); // Ensure status is hidden on welcome
                // Reset button state after returning to welcome or finishing flow
                sendBtn.disabled = false;
                sendBtn.innerHTML = '<i class="fas fa-paper-plane icon"></i> إرسال الطلب للروبوت'; // Reset button text
            }, 3000); // Shortened delay slightly
        } else {
             // Error status is shown by sendDataToESP
            console.warn("Failed to complete output operation."); // Debugging
            // Reset button state on failure
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="fas fa-paper-plane icon"></i> إرسال الطلب للروبوت'; // Reset button text
        }
    }


    // --- وظائف عرض وتصدير السجل ---
    function displayHistory() {
        console.log("Displaying history..."); // Debugging
        const operationsLog = getEl('operationsLog');
         if (!operationsLog) {
             console.error("Operations log element #operationsLog not found. Cannot display history."); // Debugging
             return; // Ensure element exists
         }

        operationsLog.innerHTML = ''; // Clear previous content

        // Ensure operationsHistory is a valid array before proceeding
        if (!Array.isArray(operationsHistory) || operationsHistory.length === 0) {
            operationsLog.innerHTML = '<p>لا توجد عمليات مسجلة.</p>';
            console.log("History is empty, displaying empty message."); // Debugging
            return;
        }

        // Display latest operations first (operationsHistory is unshifted, so it's already in reverse chronological order)
        operationsHistory.forEach((op, index) => {
            // Basic validation for operation object structure
             if (!op || typeof op !== 'object' || !op.type || !op.timestamp) {
                 console.warn("Skipping invalid operation entry in history:", op); // Debugging
                 return; // Skip invalid entries
             }

            const entryDiv = document.createElement('div');
            entryDiv.classList.add('log-entry');
            // Use op.id as a unique identifier if available, otherwise fallback to index
            entryDiv.dataset.id = op.id || `index-${index}`;

            let itemsSummary = '';
            if (op.type === 'input') {
                // Calculate counts for input summary
                const c = ((op.items && Array.isArray(op.items)) ? op.items : []) // Ensure items is an array
                    .reduce((a, i) => {
                        if(i && i.type && ['A', 'B', 'C', 'D'].includes(i.type)){ // Check item and type validity
                           a[i.type] = (a[i.type] || 0) + 1;
                        } else {
                            console.warn("Skipping invalid item in input summary count:", i); // Debugging
                        }
                        return a;
                    }, {A:0, B:0, C:0, D:0}); // Initialize counts for all types
                itemsSummary = `(${Object.entries(c).map(([k, v]) => `${k}:${v}`).join(', ')})`;

            } else if (op.type === 'output' && op.itemsRequested && typeof op.itemsRequested === 'object') {
                 // Filter for requested items > 0 for output summary
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

        // Add event listeners for toggling details
        operationsLog.querySelectorAll('.log-entry-header').forEach(header => {
            header.addEventListener('click', () => {
                 console.log("History entry header clicked. Toggling details."); // Debugging
                header.closest('.log-entry').classList.toggle('open');
            });
        });
         console.log("History display updated. Total entries rendered:", operationsHistory.length); // Debugging
    }


    function generateItemsTable(operation) {
        let tableHTML = '<table><thead><tr><th>الصنف</th>';
        if (operation.type === 'input') {
            tableHTML += '<th>وقت المسح</th></tr></thead><tbody>';
            // Ensure items is an array before iterating
            ((operation.items && Array.isArray(operation.items)) ? operation.items : []).forEach(item => {
                 // Basic validation for item object
                 if (item && typeof item === 'object') {
                    tableHTML += `<tr><td>${item.type || '-'}</td><td>${item.scanTime ? new Date(item.scanTime).toLocaleTimeString('ar-EG') : '-'}</td></tr>`;
                 } else {
                      console.warn("Skipping invalid item in history table:", item); // Debugging
                 }
            });
             // If no items in input operation
            if (!((operation.items && Array.isArray(operation.items)) && operation.items.length > 0)) {
                 tableHTML += `<tr><td>N/A</td><td>لا يوجد أصناف ممسوحة</td></tr>`;
            }

        } else if (operation.type === 'output' && operation.itemsRequested && typeof operation.itemsRequested === 'object') {
            tableHTML += '<th>الكمية المطلوبة</th></tr></thead><tbody>';
             let hasItems = false;
             // Ensure itemsRequested is an object
            for (const [type, quantity] of Object.entries(operation.itemsRequested)) {
                 const qty = parseInt(quantity) || 0;
                if (qty > 0) {
                    hasItems = true;
                    tableHTML += `<tr><td>${type}</td><td>${qty}</td></tr>`;
                }
            }
             // If no items requested (all quantities were 0 or itemsRequested was empty/invalid), add a row indicating that
             if (!hasItems) {
                 tableHTML += `<tr><td>N/A</td><td>لم يطلب شيء</td></tr>`;
             }
        } else {
             // Handle operations with unknown type or missing item data
             tableHTML += '<th>الحالة</th></tr></thead><tbody><tr><td>لا يوجد تفاصيل</td><td>-</td></tr>';
        }
        tableHTML += '</tbody></table>';
        return tableHTML;
    }


    function exportSummaryCsv() {
         console.log("Exporting summary CSV..."); // Debugging
         if (!Array.isArray(operationsHistory) || operationsHistory.length === 0) {
             alert("لا توجد بيانات لتصديرها.");
             console.warn("Attempted to export summary CSV with no history data."); // Debugging
             return;
         }
         const headers = ["رقم العملية", "التاريخ", "الوقت", "نوع العملية", "اسم الزبون", "هاتف الزبون", "الكمية A", "الكمية B", "الكمية C", "الكمية D"];
         let csvRows = [headers.join(";")];
         // Helper function to format CSV fields
         const fmt = (v) => {
             if(v == null) return ''; // Use empty string for null/undefined
             let s = String(v);
             // If string contains double quotes, semicolons, or newlines, wrap in double quotes and escape internal quotes
             if(s.search(/["\n;]/g) >= 0) s = `"${s.replace(/"/g,'""')}"`;
             return s;
         };

         // Iterate through history in chronological order for export (reverse of display order)
         [...operationsHistory].reverse().forEach(op => {
             // Basic validation
             if (!op || typeof op !== 'object' || !op.type || !op.timestamp) {
                 console.warn("Skipping invalid operation entry during summary export:", op); // Debugging
                 return; // Skip invalid entries
             }

             const ts = new Date(op.timestamp);
             // UsegetFullYear-MM-DD format for date in CSV (sv-SE locale is good for this)
             const d = isNaN(ts.getTime()) ? '-' : ts.toLocaleDateString('sv-SE');
             // Use HH:MM:SS format for time in CSV (sv-SE locale is good for this)
             const t = isNaN(ts.getTime()) ? '-' : ts.toLocaleTimeString('sv-SE');


             let counts = {A:0, B:0, C:0, D:0};

             if(op.type === 'input' && op.items && Array.isArray(op.items)){
                 // Calculate counts for input items
                 op.items.forEach(i=>{
                      if(i && i.type && ['A', 'B', 'C', 'D'].includes(i.type)){
                         counts[i.type]=(counts[i.type]||0)+1;
                      }
                 });
             } else if (op.type === 'output' && op.itemsRequested && typeof op.itemsRequested === 'object') {
                  // Use requested quantities for output items
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

         const csv = "\uFEFF" + csvRows.join("\r\n"); // Add BOM for UTF-8 in Excel
         const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
         const url = URL.createObjectURL(blob);
         const link = document.createElement("a");
         link.href = url;
         link.download = `ملخص_عمليات_المخزن_${new Date().toISOString().slice(0, 10)}.csv`; // Add date to filename
         document.body.appendChild(link);
         link.click();
         document.body.removeChild(link);
         URL.revokeObjectURL(url);
         console.log("Summary CSV export initiated."); // Debugging
    }


    function exportDetailedCsv() {
         console.log("Exporting detailed CSV..."); // Debugging
         if (!Array.isArray(operationsHistory) || operationsHistory.length === 0) {
             alert("لا توجد بيانات لتصديرها.");
             console.warn("Attempted to export detailed CSV with no history data."); // Debugging
             return;
         }
         const headers = ["رقم العملية", "المعرف الفريد", "تاريخ العملية", "وقت العملية", "نوع العملية", "اسم الزبون", "هاتف الزبون", "الصنف", "الكمية", "ملاحظات/وقت المسح"];
         let csvRows = [headers.join(";")];
          // Helper function to format CSV fields
         const fmt = (v) => {
             if(v == null) return ''; // Use empty string for null/undefined
             let s = String(v);
              // If string contains double quotes, semicolons, or newlines, wrap in double quotes and escape internal quotes
             if(s.search(/["\n;]/g) >= 0) s = `"${s.replace(/"/g,'""')}"`;
             return s;
         };

         // Iterate through history in chronological order for export
         [...operationsHistory].reverse().forEach(op => {
             // Basic validation
             if (!op || typeof op !== 'object' || !op.type || !op.timestamp) {
                 console.warn("Skipping invalid operation entry during detailed export:", op); // Debugging
                 return; // Skip invalid entries
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
                 // Create a row for each scanned item
                 op.items.forEach(item=>{
                      // Basic validation for item
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
                           console.warn("Skipping invalid item in history during detailed export:", item); // Debugging
                      }
                 });
                 // If no items in input, add a row indicating that
                 if (!itemsAdded) {
                     const row = [opNumber, opId, d, t, opType, name, phone, "N/A", 0, "No items scanned"];
                     csvRows.push(row.map(fmt).join(";"));
                 }

             } else if (op.type === 'output' && op.itemsRequested && typeof op.itemsRequested === 'object') {
                 let addedItems = false;
                 // Create a row for each requested item with quantity > 0
                 for(const type in op.itemsRequested){
                     const qty = parseInt(op.itemsRequested[type]) || 0;
                     if(qty > 0){
                         addedItems = true;
                         const itemType = type || '-';
                         const row = [
                             opNumber, opId, d, t, opType, name, phone,
                             itemType, qty, "Request"
                         ];
                         csvRows.push(row.map(fmt).join(";"));
                     }
                 }
                 // If no items requested (all quantities were 0 or itemsRequested was empty/invalid), add a row indicating that
                 if (!addedItems) {
                     const row = [opNumber, opId, d, t, opType, name, phone, "N/A", 0, "No items requested"];
                     csvRows.push(row.map(fmt).join(";"));
                 }

             } else {
                  // Handle operations with unknown type or missing data
                 const row = [opNumber, opId, d, t, opType, name, phone, "N/A", 0, "No item data"];
                 csvRows.push(row.map(fmt).join(";"));
             }
         });

         const csv = "\uFEFF" + csvRows.join("\r\n"); // Add BOM for UTF-8 in Excel
         const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
         const url = URL.createObjectURL(blob);
         const link = document.createElement("a");
         link.href = url;
         link.download = `سجل_تفصيلي_عمليات_المخزن_${new Date().toISOString().slice(0, 10)}.csv`; // Add date to filename
         document.body.appendChild(link);
         link.click();
         document.body.removeChild(link);
         URL.revokeObjectURL(url);
         console.log("Detailed CSV export initiated."); // Debugging
    }


    // --- إعداد مستمعي الأحداث (مرة واحدة) ---
function setupEventListeners() {
    console.log("Setting up event listeners..."); // Debugging

    // الشاشة الرئيسية
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
        // تم تعديل مستمع الحدث هنا ليعرض نافذة كلمة المرور أولاً
        viewHistoryBtn.addEventListener('click', async () => {
            console.log("View History button clicked. Prompting for password.");
            const enteredPassword = await promptForPasswordModal("الرجاء إدخال كلمة المرور لعرض السجلات:");

            // إذا ألغى المستخدم أو لم يدخل كلمة مرور
            if (enteredPassword === null) {
                console.log("Password prompt cancelled for history.");
                // نافذة كلمة المرور تم إخفاؤها بالفعل في closePasswordPrompt(null)
                return;
            }

            // التحقق من كلمة المرور
            if (checkPassword(enteredPassword)) {
                console.log("Password correct. Showing history screen.");
                // إغلاق نافذة كلمة المرور
                closePasswordPrompt(true); // أغلق النافذة بعد التحقق الناجح

                // تحميل وعرض السجل
                loadHistory();
                displayHistory();

                // إظهار محتوى السجل والشاشة
                const historyContentEl = getEl('historyContent');
                if (historyContentEl) {
                    historyContentEl.style.display = 'block';
                    console.log("#historyContent display set to block.");
                } else {
                    console.error("#historyContent not found after password check.");
                    alert("عنصر عرض السجل غير موجود في الصفحة.");
                    // حتى لو لم يتم العثور على العنصر، نبقى في شاشة السجل (التي تحتوي على المودال المخفي)
                    // أو نعود للشاشة الرئيسية كخيار أفضل
                     showScreen(screens.welcome);
                    return;
                }
                showScreen(screens.history);

            } else {
                // كلمة المرور غير صحيحة - checkPassword() تعرض رسالة الخطأ على المودال
                console.warn("Incorrect password entered for history.");
                // لا نغلق المودال هنا، نترك المستخدم يحاول مرة أخرى أو يلغي
            }
        });
    } else { console.warn("#viewHistoryBtn not found. Cannot attach listener."); }

    if (standbyBtn) {
        console.log("Attaching listener to #standbyBtn");
        standbyBtn.addEventListener('click', () => {
            console.log("Standby button clicked.");
            sendDataToESP('S', 'command');
        });
    } else { console.warn("#standbyBtn not found. Cannot attach listener."); }

    if (sleepBtn) {
        console.log("Attaching listener to #sleepBtn");
        sleepBtn.addEventListener('click', () => {
            console.log("Sleep button clicked.");
            sendDataToESP('M', 'command');
        });
    } else { console.warn("#sleepBtn not found. Cannot attach listener."); }

    // إعدادات الاتصال
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

    if (saveConnectionSettingsBtn && espIpInput && espPortInput && connectionSettingsStatus) { // أضف connectionSettingsStatus للتحقق
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
         console.warn("Connection settings elements not found. Cannot attach save listener."); // Debugging
    }

    // أحداث نافذة كلمة المرور (للسجل وتغيير كلمة المرور والحذف)
    if (submitPasswordBtn && passwordInput && passwordOverlay && passwordError) { // تحقق من وجود العناصر
        submitPasswordBtn.addEventListener('click', () => {
            console.log("Password submit button clicked."); // Debugging
            const enteredPassword = passwordInput.value;
            // لا نتحقق من كلمة المرور هنا مباشرة، بل نمررها إلى passwordResolve
            // الذي تم تعيينه في promptForPasswordModal
            if (passwordResolve) {
                 // نمرر القيمة المدخلة إلى الدالة التي تنتظر الـ Promise
                 // التحقق الفعلي من كلمة المرور سيحدث في الدالة التي استدعت promptForPasswordModal
                 closePasswordPrompt(enteredPassword);
            } else {
                 console.warn("Password submit clicked but no active passwordResolve promise."); // Debugging
                 // إذا لم يكن هناك promise نشط، فقط أغلق النافذة
                 closePasswordPrompt(null);
            }
        });

        // السماح بالضغط على Enter في حقل كلمة المرور
        passwordInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault(); // منع السلوك الافتراضي (إرسال نموذج إذا كان داخل نموذج)
                submitPasswordBtn.click(); // Simulate button click
            }
        });

    } else {
         console.warn("Password modal submit elements not found. Cannot attach listeners."); // Debugging
    }

    if (backToWelcomeFromPwd && passwordOverlay) { // تحقق من وجود العناصر
         backToWelcomeFromPwd.addEventListener('click', () => {
             console.log("Back to Welcome from Password modal clicked."); // Debugging
             // نمرر null إلى passwordResolve للإشارة إلى الإلغاء
             if (passwordResolve) {
                 closePasswordPrompt(null);
             } else {
                 // إذا لم يكن هناك promise نشط، فقط أغلق النافذة
                 closePasswordPrompt(null);
             }
              // العودة إلى الشاشة الرئيسية
             showScreen(screens.welcome);
         });
    } else {
         console.warn("Back to Welcome from Password button not found."); // Debugging
    }


    // أحداث الخطوة 1 (معلومات المصدر ونوع العملية)
    const nextBtnStep1 = formSteps.find(step => parseInt(step.dataset.step) === 1)?.querySelector('.next-btn');
    const customerNameInput = getEl('customerName');
    const actionTypeRadios = document.querySelectorAll('input[name="actionType"]');
    const actionTypeErrorEl = getEl('actionTypeError');
    const customerNameErrorEl = getEl('customerNameError'); // Get the new error element

    if (nextBtnStep1 && customerNameInput && actionTypeRadios.length > 0 && actionTypeErrorEl && customerNameErrorEl) { // تحقق من وجود جميع العناصر
        console.log("Attaching listener to Step 1 Next button."); // Debugging
        nextBtnStep1.addEventListener('click', () => {
            console.log("Step 1 Next button clicked."); // Debugging
            let isValid = true;

            // التحقق من اسم الشركة/الشخص
            if (customerNameInput.value.trim() === '') {
                customerNameErrorEl.textContent = "الرجاء إدخال اسم الشركة أو الشخص.";
                customerNameInput.style.borderColor = '#dc3545'; // Highlight input with error color
                isValid = false;
                console.warn("Customer name is empty."); // Debugging
            } else {
                customerNameErrorEl.textContent = ''; // Clear error
                customerNameInput.style.borderColor = ''; // Reset border color
                console.log("Customer name is valid."); // Debugging
            }

            // التحقق من اختيار نوع العملية
            let selectedActionType = null;
            actionTypeRadios.forEach(radio => {
                if (radio.checked) {
                    selectedActionType = radio.value;
                }
            });

            if (!selectedActionType) {
                actionTypeErrorEl.textContent = "الرجاء تحديد نوع العملية (إدخال أو إخراج).";
                 // Optional: highlight radio group container
                 const radioGroupDiv = actionTypeErrorEl.closest('.form-group');
                 if(radioGroupDiv) radioGroupDiv.style.border = '1px solid #dc3545';
                isValid = false;
                console.warn("No action type selected."); // Debugging
            } else {
                actionTypeErrorEl.textContent = ''; // Clear error
                 const radioGroupDiv = actionTypeErrorEl.closest('.form-group');
                 if(radioGroupDiv) radioGroupDiv.style.border = ''; // Reset border
                currentOperationType = selectedActionType; // Store the selected type
                console.log(`Action type selected: ${currentOperationType}`); // Debugging
            }

            // إذا كان النموذج صالحاً، انتقل إلى الخطوة التالية
            if (isValid) {
                console.log("Step 1 validation passed. Proceeding to step 2."); // Debugging
                // تخزين بيانات العملية الحالية (الاسم والهاتف)
                currentOperationData.customerName = customerNameInput.value.trim();
                currentOperationData.customerPhone = getEl('customerPhone').value.trim(); // Get phone value
                showStep(2); // انتقل إلى الخطوة 2
            } else {
                 console.warn("Step 1 validation failed."); // Debugging
            }
        });

        // إضافة مستمعين لتغيير لون حدود حقل الاسم عند الكتابة/التركيز
        customerNameInput.addEventListener('input', () => {
            if (customerNameInput.value.trim() !== '') {
                customerNameErrorEl.textContent = ''; // Clear error on input
                customerNameInput.style.borderColor = ''; // Reset border color
            }
        });
         customerNameInput.addEventListener('blur', () => {
             if (customerNameInput.value.trim() === '') {
                 customerNameErrorEl.textContent = "الرجاء إدخال اسم الشركة أو الشخص.";
                 customerNameInput.style.borderColor = '#dc3545'; // Highlight input with error color
             }
         });


        // إضافة مستمعين لأزرار الراديو لتحديث الكلاس selected
        actionTypeRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                 console.log(`Radio button for ${radio.value} changed.`); // Debugging
                 const radioGroupDiv = actionTypeErrorEl.closest('.form-group');
                 if(radioGroupDiv) radioGroupDiv.style.border = ''; // Reset border on change
                 actionTypeErrorEl.textContent = ''; // Clear error message on change

                 // Remove 'selected' class from all labels in this group
                 const labels = radio.closest('.radio-group-horizontal').querySelectorAll('label');
                 labels.forEach(label => label.classList.remove('selected'));

                 // Add 'selected' class to the label of the checked radio button
                 if (radio.checked) {
                    radio.closest('label').classList.add('selected');
                    currentOperationType = radio.value; // Store the selected type immediately
                    console.log(`Action type selected: ${currentOperationType}`); // Debugging
                 } else {
                      currentOperationType = null; // Should not happen with radio buttons, but good practice
                 }
            });
        });

    } else {
         console.warn("Step 1 navigation or validation elements not found. Cannot attach listener."); // Debugging
    }


    // أحداث الخطوة 2 (الإدخال)
    const finishInputBtn = getEl('finishInputBtn');
    const qrInput = getEl('qrInput');
    const saveDelayBtn = getEl('saveDelayBtn');
    const scanDelayInput = getEl('scanDelayInput');

    if (finishInputBtn) {
        console.log("Attaching listener to #finishInputBtn"); // Debugging
        finishInputBtn.addEventListener('click', completeInputOperation);
    } else { console.warn("#finishInputBtn not found."); }

    if (qrInput) {
        console.log("Attaching listener to #qrInput"); // Debugging
        qrInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault(); // منع السلوك الافتراضي (إرسال نموذج إذا كان داخل نموذج)
                handleQrScan(); // معالجة المسح الضوئي
            }
        });
    } else { console.warn("#qrInput not found."); }

    if (saveDelayBtn && scanDelayInput) { // تحقق من وجود العنصرين
         console.log("Attaching listener to #saveDelayBtn"); // Debugging
         saveDelayBtn.addEventListener('click', saveScanDelay);
         // إضافة مستمع لحدث 'change' على حقل التأخير أيضاً للحفظ عند تغيير القيمة يدوياً
         scanDelayInput.addEventListener('change', saveScanDelay);
    } else {
         console.warn("#saveDelayBtn or #scanDelayInput not found."); // Debugging
    }


    // أحداث الخطوة 2 (الإخراج)
    const sendOutputBtn = getEl('sendOutputBtn');
    const fillFromLastInputBtn = getEl('fillFromLastInputBtn');

    if (sendOutputBtn) {
        console.log("Attaching listener to #sendOutputBtn"); // Debugging
        sendOutputBtn.addEventListener('click', completeOutputOperation);
    } else { console.warn("#sendOutputBtn not found."); }

     if (fillFromLastInputBtn) {
         console.log("Attaching listener to #fillFromLastInputBtn"); // Debugging
         fillFromLastInputBtn.addEventListener('click', populateOutputFromLastInput);
     } else {
          console.warn("#fillFromLastInputBtn not found."); // Debugging
     }


    // أحداث أزرار التنقل (السابق)
    const prevBtns = screens.operation.querySelectorAll('.prev-btn');
    if (prevBtns.length > 0) {
        console.log(`Attaching listeners to ${prevBtns.length} .prev-btn elements.`); // Debugging
        prevBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                console.log("Previous button clicked."); // Debugging
                if (currentStep > 1) {
                    resetCurrentOperation(); // إعادة تعيين العملية عند العودة للخطوة 1
                    showStep(currentStep - 1);
                }
            });
        });
    } else { console.warn("Previous buttons (.prev-btn) not found."); }

    // أحداث أزرار الإلغاء
    const cancelOpBtns = screens.operation.querySelectorAll('.btn-cancel');
     if (cancelOpBtns.length > 0) {
         console.log(`Attaching listeners to ${cancelOpBtns.length} .btn-cancel elements.`); // Debugging
         cancelOpBtns.forEach(btn => {
             btn.addEventListener('click', () => {
                 console.log("Cancel button clicked."); // Debugging
                 if (confirm("هل أنت متأكد من إلغاء العملية الحالية؟ سيتم فقدان أي بيانات لم يتم حفظها.")) {
                     resetCurrentOperation();
                     showScreen(screens.welcome);
                     showStatus(getEl('generalStatus'), "تم إلغاء العملية.", 'info');
                     setTimeout(() => hideStatus(getEl('generalStatus')), 2000);
                     console.log("Operation cancelled."); // Debugging
                 }
             });
         });
     } else {
          console.warn("Cancel buttons (.btn-cancel) not found."); // Debugging
     }


    // أحداث شاشة السجل
    const backToWelcomeFromHistoryBtn = getEl('backToWelcomeFromHistory');
    const exportSummaryCsvBtn = getEl('exportSummaryCsvBtn');
    const exportDetailedCsvBtn = getEl('exportDetailedCsvBtn');
    const changePasswordBtn = getEl('changePasswordBtn');
    const deleteHistoryBtn = getEl('deleteHistoryBtn');


    if (backToWelcomeFromHistoryBtn) {
        console.log("Attaching listener to #backToWelcomeFromHistory"); // Debugging
        backToWelcomeFromHistoryBtn.addEventListener('click', () => {
            console.log("Back to Welcome from History button clicked."); // Debugging
            // إخفاء محتوى السجل قبل العودة
            const historyContentEl = getEl('historyContent');
            if(historyContentEl) historyContentEl.style.display = 'none';
             else console.warn("#historyContent not found when returning from history."); // Debugging
            showScreen(screens.welcome);
        });
    } else { console.warn("#backToWelcomeFromHistory not found."); }

    if (exportSummaryCsvBtn) {
        console.log("Attaching listener to #exportSummaryCsvBtn"); // Debugging
        exportSummaryCsvBtn.addEventListener('click', exportSummaryCsv);
    } else { console.warn("#exportSummaryCsvBtn not found."); }

    if (exportDetailedCsvBtn) {
        console.log("Attaching listener to #exportDetailedCsvBtn"); // Debugging
        exportDetailedCsvBtn.addEventListener('click', exportDetailedCsv);
    } else { console.warn("#exportDetailedCsvBtn not found."); }

    if (changePasswordBtn) {
        console.log("Attaching listener to #changePasswordBtn"); // Debugging
        changePasswordBtn.addEventListener('click', handleChangePassword);
    } else { console.warn("#changePasswordBtn not found."); }

    if (deleteHistoryBtn) {
        console.log("Attaching listener to #deleteHistoryBtn"); // Debugging
        deleteHistoryBtn.addEventListener('click', handleDeleteHistory);
    } else { console.warn("#deleteHistoryBtn not found."); }


    console.log("Event listeners setup complete."); // Debugging

}

    // --- بدء تشغيل التطبيق ---
    // Define validationErrorElements after getEl is available
    // هذه المتغيرات لم يتم استخدامها بشكل كامل في الكود الأصلي
    // const validationErrorElements = {
    //     actionType: getEl('actionTypeError'),
    //     output: getEl('outputError'),
    //     customerName: getEl('customerNameError') // أضف هذا
    // };

    initializeApp(); // Start the application initialization

});
