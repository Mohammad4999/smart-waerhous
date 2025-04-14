document.addEventListener('DOMContentLoaded', () => {
    // --- الحصول على عناصر الواجهة ---
    const welcomeScreen = document.getElementById('welcomeScreen');
    const operationScreen = document.getElementById('operationScreen');
    const historyScreen = document.getElementById('historyScreen');
    const screens = [welcomeScreen, operationScreen, historyScreen]; // مصفوفة الشاشات

    const startNewBtn = document.getElementById('startNewBtn');
    const viewHistoryBtn = document.getElementById('viewHistoryBtn');
    const backToWelcomeFromForm = document.getElementById('backToWelcomeFromForm');
    const backToWelcomeFromHistory = document.getElementById('backToWelcomeFromHistory');

    const operationForm = document.getElementById('operationForm');
    const formSteps = Array.from(operationForm.querySelectorAll('.form-step'));
    const nextBtns = operationForm.querySelectorAll('.next-btn');
    const prevBtns = operationForm.querySelectorAll('.prev-btn');
    const submitBtn = document.getElementById('submitBtn');

    const customerNameInput = document.getElementById('customerName');
    const customerPhoneInput = document.getElementById('customerPhone');
    const itemQuantityInput = document.getElementById('itemQuantity');

    const summaryName = document.getElementById('summaryName');
    const summaryPhone = document.getElementById('summaryPhone');
    const summaryAction = document.getElementById('summaryAction');
    const summaryItem = document.getElementById('summaryItem');
    const summaryQuantity = document.getElementById('summaryQuantity');
    const statusMessage = document.getElementById('statusMessage');

    const operationsLog = document.getElementById('operationsLog');
    const showAllBtn = document.getElementById('showAllBtn');
    const showRecentBtn = document.getElementById('showRecentBtn');

    const connectSerialBtn = document.getElementById('connectSerialBtn');

    // --- حالة التطبيق ---
    let currentStep = 1;
    let operationsHistory = JSON.parse(localStorage.getItem('operationsHistory')) || []; // تحميل السجل
    let serialPort = null; // لـ Web Serial API

    // --- وظائف الواجهة ---

    // وظيفة لإظهار شاشة محددة وإخفاء البقية
    function showScreen(screenToShow) {
        screens.forEach(screen => {
            screen.classList.remove('active');
        });
        if (screenToShow) {
            screenToShow.classList.add('active');
        }
    }

    // وظيفة لإظهار خطوة محددة في النموذج
    function showStep(stepNumber) {
        formSteps.forEach((step, index) => {
            step.classList.toggle('active-step', index + 1 === stepNumber);
        });
        currentStep = stepNumber; // تحديث الخطوة الحالية
    }

    // وظيفة لتحديث ملخص العملية
    function updateSummary() {
        const formData = new FormData(operationForm);
        const actionType = formData.get('actionType');
        const itemType = formData.get('itemType');

        summaryName.textContent = customerNameInput.value || 'غير محدد';
        summaryPhone.textContent = customerPhoneInput.value || 'غير محدد';
        summaryAction.textContent = actionType === 'input' ? 'إدخال بضاعة' : (actionType === 'output' ? 'إخراج بضاعة' : 'غير محدد');
        summaryItem.textContent = itemType ? `النوع ${itemType}` : 'غير محدد';
        summaryQuantity.textContent = itemQuantityInput.value || 'غير محدد';
    }

    // وظيفة لعرض سجل العمليات
    function displayHistory(limit = 0) { // limit = 0 لعرض الكل
        operationsLog.innerHTML = ''; // مسح السجل الحالي
        const historyToDisplay = limit > 0 ? operationsHistory.slice(-limit) : [...operationsHistory]; // أخذ آخر 'limit' أو الكل

        if (historyToDisplay.length === 0) {
            operationsLog.innerHTML = '<p>لا توجد عمليات مسجلة حتى الآن.</p>';
            return;
        }

        // عرض الأحدث أولاً
        historyToDisplay.reverse().forEach(op => {
            const entryDiv = document.createElement('div');
            entryDiv.classList.add('log-entry');
            entryDiv.innerHTML = `
                <span class="log-date">${new Date(op.timestamp).toLocaleString('ar-EG')}</span>
                <p><strong>الزبون:</strong> ${op.customerName || 'غير محدد'}</p>
                <p><strong>العملية:</strong> ${op.actionType === 'input' ? 'إدخال' : 'إخراج'} بضاعة</p>
                <p><strong>النوع:</strong> ${op.itemType}</p>
                <p><strong>الكمية:</strong> ${op.itemQuantity}</p>
            `;
            operationsLog.appendChild(entryDiv);
        });
    }

    // وظيفة لحفظ السجل في التخزين المحلي
    function saveHistory() {
        localStorage.setItem('operationsHistory', JSON.stringify(operationsHistory));
    }

     // وظيفة لإظهار رسائل الحالة
    function showStatus(message, type = 'info') { // types: info, success, error
        statusMessage.textContent = message;
        statusMessage.className = `status-message ${type}`; // إعادة تعيين الكلاسات
        statusMessage.style.display = 'block';
    }
    function hideStatus() {
        statusMessage.style.display = 'none';
    }


    // --- محاكاة الاتصال بـ Arduino (Web Serial API) ---
    async function connectSerial() {
        if ('serial' in navigator) {
            try {
                showStatus('جاري طلب السماح بالوصول للمنفذ التسلسلي...', 'info');
                serialPort = await navigator.serial.requestPort();
                await serialPort.open({ baudRate: 9600 }); // أو السرعة التي يستخدمها الأردوينو
                showStatus('تم الاتصال بـ Arduino بنجاح!', 'success');
                connectSerialBtn.textContent = '🔌 متصل';
                connectSerialBtn.disabled = true; // تعطيل الزر بعد الاتصال
                // يمكنك إضافة مستمع لقراءة البيانات من الأردوينو إذا لزم الأمر
                // readFromSerial();
            } catch (err) {
                showStatus(`فشل الاتصال: ${err.message}`, 'error');
                console.error('Error connecting to serial port:', err);
                serialPort = null;
            }
        } else {
            showStatus('Web Serial API غير مدعوم في هذا المتصفح.', 'error');
            alert('عذراً، متصفحك لا يدعم Web Serial API اللازم للاتصال المباشر بـ Arduino.');
        }
    }

    async function sendToArduino(dataString) {
        if (!serialPort || !serialPort.writable) {
            showStatus('خطأ: المنفذ التسلسلي غير متصل أو غير جاهز للكتابة.', 'error');
            console.warn('Serial port not available for writing.');
             // محاكاة للإرسال في حالة عدم الاتصال
             console.log(`(محاكاة) تم إرسال للـ Arduino: ${dataString}`);
             showStatus(`(محاكاة) تم إرسال البيانات بنجاح: ${dataString}`, 'success');
             // تأخير بسيط للمحاكاة
             await new Promise(resolve => setTimeout(resolve, 1000));
             return true; // نجاح المحاكاة
        }

        try {
            showStatus('جاري إرسال البيانات إلى Arduino...', 'info');
            const writer = serialPort.writable.getWriter();
            const data = new TextEncoder().encode(dataString + '\n'); // إضافة سطر جديد ليفهمه الأردوينو
            await writer.write(data);
            writer.releaseLock();
            showStatus('تم إرسال البيانات بنجاح!', 'success');
            console.log('Data sent to Arduino:', dataString);
            return true; // نجاح الإرسال الفعلي
        } catch (err) {
            showStatus(`فشل إرسال البيانات: ${err.message}`, 'error');
            console.error('Error writing to serial port:', err);
            return false; // فشل الإرسال
        }
    }

    // (اختياري) وظيفة لقراءة البيانات من الأردوينو
    async function readFromSerial() {
        while (serialPort && serialPort.readable) {
            const reader = serialPort.readable.getReader();
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) {
                        // السماح للقارئ بالتحرير
                        reader.releaseLock();
                        break;
                    }
                    // value هو Uint8Array
                    const text = new TextDecoder().decode(value);
                    console.log('Data received from Arduino:', text);
                    // يمكنك عرض هذه البيانات في الواجهة أو استخدامها لتحديث الحالة
                    // showStatus(`Arduino يقول: ${text}`, 'info');
                }
            } catch (error) {
                console.error('Error reading from serial port:', error);
                 showStatus(`خطأ في القراءة من المنفذ: ${error.message}`, 'error');
            } finally {
                reader.releaseLock();
            }
        }
    }


    // --- ربط الأحداث ---

    // أزرار الشاشة الرئيسية
    startNewBtn.addEventListener('click', () => {
        operationForm.reset(); // إعادة تعيين النموذج عند البدء
        showStep(1); // ابدأ من الخطوة الأولى
        hideStatus(); // إخفاء رسائل الحالة القديمة
        showScreen(operationScreen);
    });

    viewHistoryBtn.addEventListener('click', () => {
        displayHistory(); // عرض كل السجل افتراضياً
        showAllBtn.classList.add('active'); // تفعيل زر "عرض الكل"
        showRecentBtn.classList.remove('active');
        showScreen(historyScreen);
    });

    // أزرار العودة للشاشة الرئيسية
    backToWelcomeFromForm.addEventListener('click', () => showScreen(welcomeScreen));
    backToWelcomeFromHistory.addEventListener('click', () => showScreen(welcomeScreen));

    // أزرار التنقل في النموذج
    nextBtns.forEach(button => {
        button.addEventListener('click', () => {
            const currentStepElement = formSteps[currentStep - 1];
            const inputs = Array.from(currentStepElement.querySelectorAll('input[required]'));
            let isValid = true;

            // التحقق من الحقول المطلوبة في الخطوة الحالية
            inputs.forEach(input => {
                if (input.type === 'radio') {
                    // التحقق من اختيار راديو واحد على الأقل في المجموعة
                    const radioGroup = currentStepElement.querySelector(`input[name="${input.name}"]:checked`);
                    if (!radioGroup) {
                        isValid = false;
                    }
                } else if (!input.value.trim()) {
                    isValid = false;
                    input.style.borderColor = 'red'; // إبراز الحقل الفارغ
                } else {
                     input.style.borderColor = '#ccc'; // إعادة اللون الطبيعي
                }
            });

            if (!isValid) {
                alert('الرجاء ملء جميع الحقول المطلوبة في هذه الخطوة.');
                return;
            }

            // إذا كانت الخطوة الحالية هي قبل الأخيرة (الكمية)، قم بتحديث الملخص
            if (currentStep === 4) {
                updateSummary();
            }

            if (currentStep < formSteps.length) {
                showStep(currentStep + 1);
            }
        });
    });

    prevBtns.forEach(button => {
        button.addEventListener('click', () => {
            if (currentStep > 1) {
                showStep(currentStep - 1);
            }
        });
    });

    // زر إرسال النموذج (بدء العملية)
    operationForm.addEventListener('submit', async (e) => {
        e.preventDefault(); // منع الإرسال التقليدي للنموذج
        submitBtn.disabled = true; // تعطيل الزر أثناء المعالجة
        submitBtn.innerHTML = '<span class="icon">⏳</span> جاري التنفيذ...';

        // 1. جمع البيانات النهائية
        const formData = new FormData(operationForm);
        const operationData = {
            customerName: formData.get('customerName'),
            customerPhone: formData.get('customerPhone'),
            actionType: formData.get('actionType'),
            itemType: formData.get('itemType'),
            itemQuantity: formData.get('itemQuantity'),
            timestamp: new Date().toISOString() // إضافة وقت العملية
        };

        // 2. إنشاء سلسلة بيانات للإرسال إلى Arduino (مثال: CSV أو JSON بسيط)
        // تنسيق مقترح: Action,ItemType,Quantity
        // مثال: INPUT,A,10 أو OUTPUT,C,5
        const arduinoString = `${operationData.actionType.toUpperCase()},${operationData.itemType},${operationData.itemQuantity}`;

        // 3. محاولة إرسال البيانات إلى Arduino
        const sentSuccessfully = await sendToArduino(arduinoString);

        if(sentSuccessfully) {
            // 4. إضافة العملية إلى السجل المحلي
            operationsHistory.push(operationData);
            saveHistory(); // حفظ السجل المحدث

            // 5. عرض رسالة نجاح وإعادة التعيين
            // showStatus(`تم ${operationData.actionType === 'input' ? 'إدخال' : 'إخراج'} ${operationData.itemQuantity} من النوع ${operationData.itemType} بنجاح.`, 'success');
            // الرسالة من sendToArduino كافية

            // تأخير بسيط ثم العودة للشاشة الرئيسية
            setTimeout(() => {
                operationForm.reset();
                showStep(1);
                hideStatus();
                showScreen(welcomeScreen);
                 submitBtn.disabled = false; // إعادة تفعيل الزر
                 submitBtn.innerHTML = '<span class="icon">🚀</span> بدء التنفيذ وإرسال للـ Arduino';
            }, 2500); // انتظر ثانيتين ونصف قبل العودة
        } else {
            // فشل الإرسال (تم عرض الرسالة في sendToArduino)
             submitBtn.disabled = false; // إعادة تفعيل الزر
             submitBtn.innerHTML = '<span class="icon">🚀</span> بدء التنفيذ وإرسال للـ Arduino';
        }

    });

    // أزرار فلترة السجل
    showAllBtn.addEventListener('click', () => {
        displayHistory();
        showAllBtn.classList.add('active');
        showRecentBtn.classList.remove('active');
    });
    showRecentBtn.addEventListener('click', () => {
        displayHistory(5); // عرض آخر 5 عمليات
        showRecentBtn.classList.add('active');
        showAllBtn.classList.remove('active');
    });

    // زر محاولة الاتصال بـ Arduino
    connectSerialBtn.addEventListener('click', connectSerial);


    // --- التشغيل الأولي ---
    showScreen(welcomeScreen); // إظهار شاشة الترحيب عند التحميل
    displayHistory(); // عرض السجل في حال وجوده (وإن كانت الشاشة مخفية)

});