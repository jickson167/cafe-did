// Supabase 설정
const SUPABASE_URL = 'https://wbiubbcvsyprqrknnfyb.supabase.co'; // 여기에 Supabase URL 입력
const SUPABASE_ANON_KEY = 'sb_publishable__ZDgdPtpamWxdUAx7HfHkQ_MgJtwHQ1'; // 여기에 Supabase Anon Key 입력

// Supabase 클라이언트 초기화
const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 디바이스 유형 자동 감지
function detectDeviceType() {
    const ua = navigator.userAgent.toLowerCase();
    const isTablet = /tablet|ipad|playbook|silk|android(?!.*mobile)/.test(ua);
    const isMobile = /mobi|iphone|ipod|android|blackberry|iemobile|windows phone|opera mini/.test(ua);

    if (isTablet) return 'tablet';
    if (isMobile) return 'mobile';
    return 'desktop';
}

function applyDeviceMode() {
    const deviceType = detectDeviceType();
    document.documentElement.setAttribute('data-device', deviceType);
    console.log(`[DID] 디바이스 자동 감지: ${deviceType}`);
}

applyDeviceMode();

// 상태 관리
let currentData = {
    waiting: [],
    ready: []
};
let realtimeSubscribed = false;
let hasInitialDisplayLoad = false;

// 알림음 설정
const DING_SOUND_URL = './dingdong.mp3';
let dingAudio = null;

// DOM 요소
const waitingList = document.getElementById('waitingList');
const readyList = document.getElementById('readyList');
const adImage = document.getElementById('adImage');

/**
 * 초기화
 */
async function initialize() {
    console.log('[DID] 초기화 시작...');
    
    dingAudio = createDingAudio();

    // 초기 데이터 로드
    await loadInitialData();
    
    // Realtime 구독 설정
    subscribeToRealtimeUpdates();
    
    console.log('[DID] 초기화 완료');
}

/**
 * 초기 데이터 로드
 */
async function loadInitialData() {
    try {
        const { data, error } = await supabaseClient
            .from('did_status')
            .select('data')
            .eq('id', 1)
            .single();

        if (error) {
            console.error('[DID] 데이터 조회 실패:', error);
            showError('Supabase 데이터 로드 실패');
            return;
        }

        if (data && data.data) {
            updateDisplay(data.data);
        } else {
            console.warn('[DID] 데이터가 없습니다');
            updateDisplay({ waiting: [], ready: [] });
        }
    } catch (err) {
        console.error('[DID] 예외 발생:', err);
        showError('데이터 로드 중 오류 발생');
    }
}

/**
 * Realtime 업데이트 구독
 */
function subscribeToRealtimeUpdates() {
    console.log('[DID] Realtime 구독 설정...');
    
    const subscription = supabaseClient
        .channel('did_status_changes')
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'did_status',
                filter: 'id=eq.1'
            },
            (payload) => {
                console.log('[DID] 실시간 업데이트 감지:', payload);
                if (payload.new && payload.new.data) {
                    updateDisplay(payload.new.data);
                }
            }
        )
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                realtimeSubscribed = true;
                console.log('[DID] Realtime 구독 성공');
            } else if (status === 'CHANNEL_ERROR') {
                realtimeSubscribed = false;
                console.error('[DID] Realtime 채널 오류');
            } else if (status === 'TIMED_OUT') {
                realtimeSubscribed = false;
                console.error('[DID] Realtime 타임아웃');
            } else if (status === 'CLOSED') {
                realtimeSubscribed = false;
                console.log('[DID] Realtime 채널 종료');
            }
        });
}

/**
 * 화면 업데이트
 */
function updateDisplay(newData) {
    console.log('[DID] 화면 업데이트:', newData);
    
    // 데이터 유효성 검사
    const maxWaiting = 6;
    const maxReady = 4;
    const rawWaiting = Array.isArray(newData.waiting) ? newData.waiting : [];
    const rawReady = Array.isArray(newData.ready) ? newData.ready : [];
    const waiting = rawWaiting.length > maxWaiting ? rawWaiting.slice(-maxWaiting) : rawWaiting;
    const ready = rawReady.length > maxReady ? rawReady.slice(-maxReady) : rawReady;
    // 변경사항이 없으면 렌더링 건너뜀 (깜빡임 방지)
    function arraysEqual(a, b) {
        if (a === b) return true;
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    if (hasInitialDisplayLoad && arraysEqual(waiting, currentData.waiting) && arraysEqual(ready, currentData.ready)) {
        // 변경 없음
        //console.log('[DID] 변경 없음 — 렌더링 생략');
        return;
    }

    const hasNewReady = hasInitialDisplayLoad && ready.some((orderNumber) => !currentData.ready.includes(orderNumber));
    currentData = { waiting, ready };

    // 준비중 목록 업데이트
    renderOrderCards(waitingList, waiting, 'waiting');

    // 준비완료 목록 업데이트
    renderOrderCards(readyList, ready, 'ready');

    if (hasNewReady) {
        playDingSound();
    }

    hasInitialDisplayLoad = true;
}

/**
 * 주문 카드 렌더링
 */
function renderOrderCards(container, orders, status) {
    if (!container) return;
    
    // 기존 카드 제거
    const existingCards = container.querySelectorAll('.order-card');
    
    // 새 카드 생성
    const fragment = document.createDocumentFragment();
    
    if (orders.length === 0) {
        if (status === 'waiting') {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'empty-message';
            emptyMsg.textContent = '주문이 없습니다';
            fragment.appendChild(emptyMsg);
        }
    } else {
        orders.forEach((orderNumber) => {
            const card = createOrderCard(orderNumber, status);
            fragment.appendChild(card);
        });
    }
    
    // 부드러운 전환
    container.style.opacity = '0.7';
    setTimeout(() => {
        container.innerHTML = '';
        container.appendChild(fragment);
        container.style.opacity = '1';
    }, 150);
}

/**
 * 주문 카드 생성
 */
function createOrderCard(orderNumber, status) {
    const card = document.createElement('div');
    card.className = 'order-card';
    card.setAttribute('data-order-number', orderNumber);
    card.setAttribute('data-status', status);
    
    const number = document.createElement('span');
    number.className = 'order-card-number';
    number.textContent = orderNumber;
    
    card.appendChild(number);
    
    // 클릭 이벤트 (선택사항)
    card.addEventListener('click', () => {
        console.log(`[DID] 주문번호 선택: ${orderNumber}`);
    });
    
    return card;
}

/**
 * 에러 표시
 */
function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = message;
    
    const orderSection = document.querySelector('.order-section');
    if (orderSection) {
        orderSection.innerHTML = '';
        orderSection.appendChild(errorDiv);
    }
}

/**
 * 광고 이미지 변경
 */
function setAdImage(imageUrl) {
    if (adImage) {
        adImage.src = imageUrl;
        console.log('[DID] 광고 이미지 변경:', imageUrl);
    }
}

/**
 * 광고 이미지를 동적으로 변경하는 함수
 * 예: setAdImage('./new-ad.jpg')
 */
window.setAdImage = setAdImage;

/**
 * 전체 새로고침 (테스트용)
 */
window.refreshData = loadInitialData;

function createDingAudio() {
    const element = document.getElementById('dingAudio');
    if (element) {
        return element;
    }

    const audio = new Audio(DING_SOUND_URL);
    audio.preload = 'auto';
    return audio;
}

function playDingSound() {
    if (!dingAudio)
        dingAudio = createDingAudio();

    try {
        dingAudio.currentTime = 0;
        dingAudio.play().catch((error) => {
            console.warn('[DID] 띵동 소리 재생 실패:', error);
        });
    } catch (error) {
        console.warn('[DID] 띵동 소리 재생 중 예외 발생:', error);
    }
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', initialize);

// 페이지 언로드 시 구독 정리
window.addEventListener('beforeunload', () => {
    supabaseClient.removeAllChannels();
});

// 5초마다 데이터 폴링으로 갱신
setInterval(async () => {
    console.log('[DID] 5초 자동 폴링으로 데이터 새로고침');
    await loadInitialData();
}, 5000);
