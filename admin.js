const SUPABASE_URL = 'https://wbiubbcvsyprqrknnfyb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__ZDgdPtpamWxdUAx7HfHkQ_MgJtwHQ1';

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MAX_WAITING = 6;
const MAX_READY = 4;
const DEFAULT_ADMIN_PIN = '0000';
const SKIP_PIN = true;

const pinScreen = document.getElementById('pinScreen');
const adminApp = document.getElementById('adminApp');
const pinInput = document.getElementById('pinInput');
const pinSubmitButton = document.getElementById('pinSubmitButton');
const pinError = document.getElementById('pinError');
const waitingList = document.getElementById('waitingList');
const readyList = document.getElementById('readyList');
const actionOverlay = document.getElementById('actionOverlay');
const actionCloseButton = document.getElementById('actionCloseButton');
const actionOrderNumber = document.getElementById('actionOrderNumber');
const actionOrderMenu = document.getElementById('actionOrderMenu');
const actionPrimaryButton = document.getElementById('actionPrimaryButton');
const actionSecondaryButton = document.getElementById('actionSecondaryButton');
const actionStatus = document.getElementById('actionStatus');

let currentData = { waiting: [], ready: [] };
let hasInitialDisplayLoad = false;
let verifiedPin = '';
let storeContext = null;
let selectedOrder = null;
let commandInFlight = false;
let pollingStarted = false;

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

async function resolveStoreContext() {
    const slug = getSlugFromUrl();
    if (!slug) {
        return { mode: 'legacy', legacyId: 1, slug: null, storeId: null };
    }

    const { data: storeId, error } = await supabaseClient.rpc('get_store_id_by_slug', { p_slug: slug });
    if (error || !storeId) {
        throw new Error('매장을 찾을 수 없습니다.');
    }

    return { mode: 'slug', legacyId: null, slug, storeId };
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
    const channelName = storeContext?.mode === 'slug'
        ? `did_status_admin_${storeContext.storeId}`
        : 'did_status_admin_legacy';

    const filter = storeContext?.mode === 'slug'
        ? `store_id=eq.${storeContext.storeId}`
        : 'id=eq.1';

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

    const number = document.createElement('div');
    number.className = 'order-card-number';
    number.textContent = order.number;
    card.appendChild(number);

    const menuText = formatMenuText(order.menu);
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
    selectedOrder = { number: order.number, menu: formatMenuText(order.menu), status };
    commandInFlight = false;

    actionOrderNumber.textContent = order.number;
    actionOrderMenu.textContent = formatMenuText(order.menu);
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
        actionStatus.textContent = '명령 전송 실패. KDS 실행 또는 Supabase 설정을 확인하세요.';
    }
}

async function enterAdminApp(pin) {
    verifiedPin = pin;
    pinScreen.hidden = true;
    adminApp.hidden = false;
    closeActionPopup();

    await loadInitialData();
    subscribeToRealtimeUpdates();

    if (!pollingStarted) {
        pollingStarted = true;
        setInterval(loadInitialData, 5000);
    }
}

async function handlePinSubmit() {
    const pin = pinInput.value.trim();
    pinError.hidden = true;

    if (!pin) {
        pinError.textContent = 'PIN을 입력하세요.';
        pinError.hidden = false;
        return;
    }

    try {
        storeContext = await resolveStoreContext();
        const ok = await verifyPin(pin);
        if (!ok) {
            pinError.textContent = 'PIN이 올바르지 않습니다.';
            pinError.hidden = false;
            return;
        }

        await enterAdminApp(pin);
    } catch (error) {
        console.error('[ADMIN] pin verify failed:', error);
        pinError.textContent = error.message || '입장에 실패했습니다.';
        pinError.hidden = false;
    }
}

async function initializeAdmin() {
    closeActionPopup();

    if (!shouldSkipPin()) {
        console.log('[ADMIN] PIN 화면 표시');
        return;
    }

    try {
        storeContext = await resolveStoreContext();
        verifiedPin = DEFAULT_ADMIN_PIN;
        await enterAdminApp(DEFAULT_ADMIN_PIN);
        console.log('[ADMIN] PIN 없이 바로 입장');
    } catch (error) {
        console.error('[ADMIN] auto enter failed:', error);
        pinError.textContent = error.message || '화면을 불러오지 못했습니다.';
        pinError.hidden = false;
    }
}

pinSubmitButton.addEventListener('click', handlePinSubmit);
pinInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        handlePinSubmit();
    }
});

actionCloseButton.addEventListener('click', closeActionPopup);
actionOverlay.addEventListener('click', (event) => {
    if (event.target === actionOverlay) {
        closeActionPopup();
    }
});

document.addEventListener('DOMContentLoaded', initializeAdmin);

console.log('[ADMIN] 관리 페이지 준비 완료');
