const SUPABASE_URL = 'https://wbiubbcvsyprqrknnfyb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__ZDgdPtpamWxdUAx7HfHkQ_MgJtwHQ1';

const MAX_WAITING = 6;
const MAX_READY = 4;
const DEFAULT_ADMIN_PIN = '0000';
const SKIP_PIN = false;
const ADMIN_SCRIPT_VERSION = '3';

let supabaseClient = null;
let pinScreen;
let adminApp;
let pinInput;
let pinSubmitButton;
let pinStatus;
let pinError;
let waitingList;
let readyList;
let actionOverlay;
let actionCloseButton;
let actionOrderNumber;
let actionOrderMenu;
let actionPrimaryButton;
let actionSecondaryButton;
let actionStatus;

let currentData = { waiting: [], ready: [] };
let hasInitialDisplayLoad = false;
let verifiedPin = '';
let storeContext = null;
let selectedOrder = null;
let commandInFlight = false;
let pollingStarted = false;
let pinSubmitting = false;
let realtimeSubscribed = false;
let lastPinSubmitAt = 0;

function getSlugFromUrl() {
    return new URLSearchParams(window.location.search).get('slug');
}

function shouldSkipPin() {
    if (SKIP_PIN)
        return true;

    const params = new URLSearchParams(window.location.search);
    return params.get('skipPin') === '1' || params.get('nopin') === '1';
}

function formatMenuText(menu) {
    if (!menu)
        return '';

    return menu
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim();
}

function truncateMenuLine(line, maxLength) {
    if (!line)
        return '';

    const trimmed = line.trim();
    if (trimmed.length <= maxLength)
        return trimmed;

    return `${trimmed.slice(0, Math.max(0, maxLength - 1))}...`;
}

function formatAdminMenuText(menu) {
    const plain = formatMenuText(menu);
    if (!plain)
        return '';

    return plain
        .split('\n')
        .map((line) => truncateMenuLine(line, 42))
        .filter(Boolean)
        .join('\n');
}

function createSupabaseClient() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        throw new Error('Supabase 스크립트를 불러오지 못했습니다. 네트워크 연결 후 새로고침해 주세요.');
    }

    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function bindDomReferences() {
    pinScreen = document.getElementById('pinScreen');
    adminApp = document.getElementById('adminApp');
    pinInput = document.getElementById('pinInput');
    pinSubmitButton = document.getElementById('pinSubmitButton');
    pinStatus = document.getElementById('pinStatus');
    pinError = document.getElementById('pinError');
    waitingList = document.getElementById('waitingList');
    readyList = document.getElementById('readyList');
    actionOverlay = document.getElementById('actionOverlay');
    actionCloseButton = document.getElementById('actionCloseButton');
    actionOrderNumber = document.getElementById('actionOrderNumber');
    actionOrderMenu = document.getElementById('actionOrderMenu');
    actionPrimaryButton = document.getElementById('actionPrimaryButton');
    actionSecondaryButton = document.getElementById('actionSecondaryButton');
    actionStatus = document.getElementById('actionStatus');
}

function showPinScreen() {
    if (pinScreen)
        pinScreen.hidden = false;
    if (adminApp)
        adminApp.hidden = true;
}

function hidePinError() {
    if (!pinError)
        return;

    pinError.textContent = '';
    pinError.setAttribute('hidden', '');
}

function showPinError(error) {
    if (!pinError)
        return;

    clearPinStatus();
    pinError.textContent = formatPinError(error);
    pinError.removeAttribute('hidden');
}

function clearPinStatus() {
    if (!pinStatus)
        return;

    pinStatus.textContent = '';
    pinStatus.classList.remove('is-loading');
}

function showPinStatus(message) {
    if (!pinStatus)
        return;

    pinStatus.textContent = message;
    pinStatus.classList.toggle('is-loading', message === '확인 중...');
}

function setPinSubmitting(submitting) {
    pinSubmitting = submitting;

    if (pinSubmitButton) {
        pinSubmitButton.disabled = submitting;
        pinSubmitButton.textContent = submitting ? '확인 중...' : '입장';
    }

    if (pinInput)
        pinInput.disabled = submitting;
}

function formatPinError(error) {
    if (!error)
        return '입장에 실패했습니다.';

    if (typeof error === 'string')
        return error;

    const schemaMessage = formatCommandError(error);
    if (/web-admin-schema\.sql/i.test(schemaMessage))
        return schemaMessage;

    const message = error.message || '';
    const details = error.details || '';

    if (/invalid_pin/i.test(message) || /invalid_pin/i.test(details)) {
        return '관리 PIN이 일치하지 않습니다. did_status.admin_pin 값을 확인하세요. (기본값 0000)';
    }

    if (message)
        return message;

    return '입장에 실패했습니다.';
}

async function resolveStoreContext() {
    const slug = getSlugFromUrl();
    if (!slug) {
        return { mode: 'legacy', legacyId: 1, slug: null, storeId: null };
    }

    const { data: storeId, error } = await supabaseClient.rpc('get_store_id_by_slug', { p_slug: slug });
    if (error) {
        if (isMissingSupabaseFunction(error)) {
            console.warn('[ADMIN] get_store_id_by_slug unavailable — using legacy did_status');
            return { mode: 'legacy', legacyId: 1, slug: null, storeId: null, requestedSlug: slug };
        }

        throw error;
    }

    if (!storeId) {
        console.warn(`[ADMIN] slug "${slug}" not found — using legacy did_status`);
        return { mode: 'legacy', legacyId: 1, slug: null, storeId: null, requestedSlug: slug };
    }

    return { mode: 'slug', legacyId: null, slug, storeId };
}

function isMissingSupabaseFunction(error) {
    const code = error?.code || '';
    const message = error?.message || '';
    return code === 'PGRST202' || /Could not find the function/i.test(message);
}

async function verifyPin(pin) {
    if (!storeContext) {
        storeContext = await resolveStoreContext();
    }

    if (storeContext.mode === 'legacy') {
        const { data, error } = await supabaseClient.rpc('verify_admin_pin_legacy', {
            p_pin: pin,
            p_legacy_id: storeContext.legacyId
        });
        if (error)
            throw error;
        return !!data;
    }

    const { data, error } = await supabaseClient.rpc('verify_admin_pin_by_slug', {
        p_slug: storeContext.slug,
        p_pin: pin
    });
    if (error)
        throw error;
    return !!data;
}

function formatCommandError(error) {
    if (!error)
        return '명령 전송 실패. KDS 실행 또는 Supabase 설정을 확인하세요.';

    const code = error.code || '';
    const message = error.message || '';
    const details = error.details || '';

    if (code === 'PGRST202' || /Could not find the function/i.test(message)) {
        return 'Supabase에 web-admin-schema.sql이 아직 적용되지 않았습니다. Dashboard → SQL Editor에서 실행해 주세요.';
    }

    if (code === '42P01' || /did_commands/i.test(message)) {
        return 'did_commands 테이블이 없습니다. Supabase SQL Editor에서 web-admin-schema.sql을 실행해 주세요.';
    }

    if (/invalid_pin/i.test(message) || /invalid_pin/i.test(details)) {
        return '관리 PIN이 일치하지 않습니다. did_status.admin_pin 값을 확인하세요. (기본값 0000)';
    }

    if (message)
        return `명령 전송 실패: ${message}`;

    return '명령 전송 실패. KDS 실행 또는 Supabase 설정을 확인하세요.';
}

async function enqueueCommand(action, orderNumber) {
    if (!verifiedPin) {
        throw new Error('PIN이 확인되지 않았습니다.');
    }

    if (storeContext.mode === 'legacy') {
        const { error } = await supabaseClient.rpc('enqueue_did_command_legacy', {
            p_pin: verifiedPin,
            p_action: action,
            p_order_number: orderNumber,
            p_legacy_id: storeContext.legacyId
        });
        if (error)
            throw error;
        return;
    }

    const { error } = await supabaseClient.rpc('enqueue_did_command_by_slug', {
        p_slug: storeContext.slug,
        p_pin: verifiedPin,
        p_action: action,
        p_order_number: orderNumber
    });
    if (error)
        throw error;
}

async function loadInitialData() {
    if (!storeContext) {
        storeContext = await resolveStoreContext();
    }

    if (storeContext.mode === 'legacy') {
        const { data, error } = await supabaseClient
            .from('did_status')
            .select('data')
            .eq('id', 1)
            .single();

        if (error)
            throw error;
        updateDisplay(data?.data || { waiting: [], ready: [] });
        return;
    }

    const { data, error } = await supabaseClient.rpc('get_did_status_by_slug', {
        p_slug: storeContext.slug
    });
    if (error)
        throw error;
    updateDisplay(data || { waiting: [], ready: [] });
}

function subscribeToRealtimeUpdates() {
    if (realtimeSubscribed || !supabaseClient || !storeContext)
        return;

    const channelName = storeContext.mode === 'slug'
        ? `did_status_admin_${storeContext.storeId}`
        : 'did_status_admin_legacy';

    const filter = storeContext.mode === 'slug'
        ? `store_id=eq.${storeContext.storeId}`
        : 'id=eq.1';

    try {
        supabaseClient
            .channel(channelName)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'did_status',
                    filter
                },
                (payload) => {
                    if (payload.new?.data) {
                        updateDisplay(payload.new.data);
                    }
                }
            )
            .subscribe();

        realtimeSubscribed = true;
    } catch (error) {
        console.warn('[ADMIN] realtime subscribe skipped:', error);
    }
}

function updateDisplay(newData) {
    const waiting = DidOrderData.trimOrders(newData.waiting, MAX_WAITING);
    const ready = DidOrderData.trimOrders(newData.ready, MAX_READY);

    if (hasInitialDisplayLoad
        && DidOrderData.ordersEqual(waiting, currentData.waiting)
        && DidOrderData.ordersEqual(ready, currentData.ready)) {
        return;
    }

    currentData = { waiting, ready };
    renderOrderCards(waitingList, waiting, 'waiting');
    renderOrderCards(readyList, ready, 'ready');
    hasInitialDisplayLoad = true;

    if (selectedOrder && commandInFlight) {
        const list = selectedOrder.status === 'waiting' ? waiting : ready;
        const stillExists = list.some((order) => order.number === selectedOrder.number);
        if (!stillExists || hasOrderMoved(selectedOrder)) {
            closeActionPopup();
        }
    }
}

function hasOrderMoved(selected) {
    if (selected.status === 'waiting') {
        return currentData.ready.some((order) => order.number === selected.number);
    }

    return currentData.waiting.some((order) => order.number === selected.number);
}

function renderOrderCards(container, orders, status) {
    if (!container)
        return;

    const fragment = document.createDocumentFragment();

    if (orders.length === 0) {
        if (status === 'waiting') {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'empty-message';
            emptyMsg.textContent = '주문이 없습니다';
            fragment.appendChild(emptyMsg);
        }
    } else {
        orders.forEach((order) => {
            fragment.appendChild(createOrderCard(order, status));
        });
    }

    container.innerHTML = '';
    container.appendChild(fragment);
}

function createOrderCard(order, status) {
    const card = document.createElement('div');
    card.className = 'order-card';
    card.dataset.orderNumber = order.number;
    card.dataset.status = status;

    if (order.serviceType) {
        const serviceType = document.createElement('div');
        serviceType.className = 'order-card-service-type';
        serviceType.textContent = order.serviceType;
        if (order.serviceType.includes('포장')) {
            serviceType.classList.add('is-takeout');
        } else if (order.serviceType.includes('매장')) {
            serviceType.classList.add('is-dine-in');
        }
        card.appendChild(serviceType);
    }

    const number = document.createElement('div');
    number.className = 'order-card-number';
    number.textContent = order.number;
    card.appendChild(number);

    if (order.categories) {
        const categories = document.createElement('div');
        categories.className = 'order-card-categories';
        categories.textContent = order.categories;
        card.appendChild(categories);
    }

    const menuText = formatAdminMenuText(order.menu);
    if (menuText) {
        const menu = document.createElement('div');
        menu.className = 'order-card-menu';
        menu.textContent = menuText;
        card.appendChild(menu);
    }

    card.addEventListener('click', () => openActionPopup(order, status));
    return card;
}

function openActionPopup(order, status) {
    selectedOrder = {
        number: order.number,
        menu: formatAdminMenuText(order.menu),
        categories: order.categories || '',
        serviceType: order.serviceType || '',
        status
    };
    commandInFlight = false;

    actionOrderNumber.textContent = order.number;
    actionOrderMenu.textContent = [
        order.serviceType || '',
        order.categories || '',
        formatAdminMenuText(order.menu)
    ].filter(Boolean).join('\n\n');
    actionStatus.hidden = true;
    actionStatus.textContent = '';

    if (status === 'waiting') {
        actionPrimaryButton.textContent = '준비완료';
        actionSecondaryButton.textContent = '주문삭제';
        actionPrimaryButton.onclick = () => runCommand('complete');
        actionSecondaryButton.onclick = () => runCommand('cancel_waiting');
    } else {
        actionPrimaryButton.textContent = '대기로 이동';
        actionSecondaryButton.textContent = '주문삭제';
        actionPrimaryButton.onclick = () => runCommand('move_to_waiting');
        actionSecondaryButton.onclick = () => runCommand('cancel_ready');
    }

    setActionButtonsDisabled(false);
    actionOverlay.hidden = false;
    actionOverlay.classList.add('is-open');
}

function closeActionPopup() {
    actionOverlay.hidden = true;
    actionOverlay.classList.remove('is-open');
    selectedOrder = null;
    commandInFlight = false;
    setActionButtonsDisabled(false);
    actionStatus.hidden = true;
}

function setActionButtonsDisabled(disabled) {
    actionPrimaryButton.disabled = disabled;
    actionSecondaryButton.disabled = disabled;
}

async function runCommand(action) {
    if (!selectedOrder || commandInFlight) {
        return;
    }

    commandInFlight = true;
    setActionButtonsDisabled(true);
    actionStatus.hidden = false;
    actionStatus.textContent = 'KDS에 적용 중...';

    try {
        await enqueueCommand(action, selectedOrder.number);
        actionStatus.textContent = '명령 전송 완료. KDS 반영 대기 중...';
    } catch (error) {
        console.error('[ADMIN] command failed:', error);
        commandInFlight = false;
        setActionButtonsDisabled(false);
        actionStatus.textContent = formatCommandError(error);
    }
}

async function enterAdminApp(pin) {
    verifiedPin = pin;
    closeActionPopup();

    await loadInitialData();

    if (pinScreen)
        pinScreen.hidden = true;
    if (adminApp)
        adminApp.hidden = false;

    clearPinStatus();
    hidePinError();
    subscribeToRealtimeUpdates();

    if (!pollingStarted) {
        pollingStarted = true;
        setInterval(loadInitialData, 5000);
    }
}

async function handlePinSubmit(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    console.log('[ADMIN] handlePinSubmit', { version: ADMIN_SCRIPT_VERSION });

    if (pinSubmitting || !pinInput || !pinSubmitButton)
        return;

    if (!supabaseClient) {
        showPinError('Supabase 연결이 준비되지 않았습니다. 네트워크 확인 후 새로고침해 주세요.');
        return;
    }

    const pin = pinInput.value.trim();
    hidePinError();

    if (!pin) {
        showPinError('PIN을 입력하세요.');
        return;
    }

    setPinSubmitting(true);
    showPinStatus('확인 중...');
    try {
        storeContext = null;
        storeContext = await resolveStoreContext();
        const ok = await verifyPin(pin);
        if (!ok) {
            showPinError('PIN이 올바르지 않습니다. did_status.admin_pin 값을 확인하세요. (기본값 0000)');
            return;
        }

        await enterAdminApp(pin);
    } catch (error) {
        console.error('[ADMIN] pin verify failed:', error);
        showPinScreen();
        showPinError(error);
    } finally {
        setPinSubmitting(false);
        clearPinStatus();
    }
}

async function initializeAdmin() {
    closeActionPopup();
    hidePinError();
    showPinScreen();

    if (!shouldSkipPin()) {
        pinInput?.focus();
        console.log('[ADMIN] PIN 화면 표시');
        return;
    }

    setPinSubmitting(true);
    try {
        storeContext = null;
        storeContext = await resolveStoreContext();
        await enterAdminApp(DEFAULT_ADMIN_PIN);
        console.log('[ADMIN] PIN 없이 바로 입장');
    } catch (error) {
        console.error('[ADMIN] auto enter failed:', error);
        showPinError(error);
        pinInput?.focus();
    } finally {
        setPinSubmitting(false);
    }
}

function bindAdminEvents() {
    if (!pinSubmitButton) {
        console.error('[ADMIN] pinSubmitButton 요소를 찾을 수 없습니다.');
        return;
    }

    const onPinSubmit = (event) => {
        const now = Date.now();
        if (now - lastPinSubmitAt < 400)
            return;

        lastPinSubmitAt = now;
        void handlePinSubmit(event);
    };

    pinSubmitButton.addEventListener('click', onPinSubmit);
    pinSubmitButton.addEventListener('touchend', (event) => {
        event.preventDefault();
        onPinSubmit(event);
    }, { passive: false });

    pinInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            void handlePinSubmit(event);
        }
    });

    window.__adminPinSubmit = onPinSubmit;

    actionCloseButton?.addEventListener('click', closeActionPopup);
    actionOverlay?.addEventListener('click', (event) => {
        if (event.target === actionOverlay) {
            closeActionPopup();
        }
    });

    console.log('[ADMIN] 입장 버튼 이벤트 연결됨', { version: ADMIN_SCRIPT_VERSION });
}

function bootAdminApp() {
    bindDomReferences();
    bindAdminEvents();

    try {
        supabaseClient = createSupabaseClient();
        initializeAdmin();
        console.log('[ADMIN] 관리 페이지 준비 완료');
    } catch (error) {
        console.error('[ADMIN] init failed:', error);
        showPinScreen();
        showPinError(error);
    }
}

function runWhenDomReady(callback) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', callback);
        return;
    }

    callback();
}

runWhenDomReady(bootAdminApp);
