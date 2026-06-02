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

    // 화면 비율 감지
    updateAspectRatio();
    window.addEventListener('resize', updateAspectRatio);
}

function updateAspectRatio() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspectRatio = width / height;

    console.log(`[DID] 화면 비율: ${width}x${height} = ${aspectRatio.toFixed(2)}`);

    // 비율에 따라 레이아웃 분류
    let layoutType;
    if (aspectRatio >= 1.5) {
        // 16:9 이상 (가로 긴 화면)
        layoutType = 'landscape-wide';
    } else if (aspectRatio >= 1.33) {
        // 4:3 ~ 16:9 (태블릿)
        layoutType = 'landscape';
    } else {
        // 1보다 작음 (세로 화면)
        layoutType = 'portrait';
    }

    document.documentElement.setAttribute('data-aspect-layout', layoutType);
    console.log(`[DID] 레이아웃 타입: ${layoutType}`);
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
let soundUnlocked = false;
let speechSupported = 'speechSynthesis' in window;
let speechVoices = [];

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
    setupAudioUnlock();
    setupSpeechSynthesis();

    // 초기 데이터 로드
    await loadInitialData();

    // Realtime 구독 설정
    subscribeToRealtimeUpdates();

    console.log('[DID] 초기화 완료');
}

function setupAudioUnlock() {
    const unlock = () => {
        soundUnlocked = true;
        console.log('[DID] 오디오 잠금 해제됨');
    };

    document.addEventListener('click', unlock, { once: true, passive: true });
    document.addEventListener('touchstart', unlock, { once: true, passive: true });
    document.addEventListener('keydown', unlock, { once: true, passive: true });
}

function setupSpeechSynthesis() {
    if (!speechSupported) {
        console.warn('[DID] Speech Synthesis 지원되지 않음');
        return;
    }

    const loadVoices = () => {
        speechVoices = speechSynthesis.getVoices();
        console.log('[DID] 음성 목록 로드:', speechVoices.map((voice) => `${voice.name} (${voice.lang})`));
    };

    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
}

function speakText(text) {
    if (!speechSupported) {
        console.warn('[DID] 음성 합성 미지원 상태입니다.');
        return;
    }

    if (!soundUnlocked) {
        console.warn('[DID] 음성 재생 잠금 상태: 먼저 화면을 터치해주세요.');
        return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;

    if (speechVoices.length > 0) {
        utterance.voice = speechVoices.find((voice) => voice.lang.startsWith('ko')) || speechVoices[0];
    }

    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
}

function announceReadyOrders(newOrderNumbers) {
    if (!Array.isArray(newOrderNumbers) || newOrderNumbers.length === 0)
        return;

    // 단 하나의 주문비만 음성안내
    if (newOrderNumbers.length > 0) {
        playOrderNumberVoice(newOrderNumbers[0]);
    }
}

function playOrderNumberVoice(orderNumber) {
    if (!soundUnlocked || !orderNumber) {
        console.warn('[DID] 음성 재생 잠금 상태 또는 주문번호 없음');
        return;
    }

    if (orderNumber.length !== 3 || !/^[1-9]\d{2}$/.test(orderNumber)) {
        console.warn('[DID] 유효하지 않은 주문번호 형식:', orderNumber);
        return;
    }

    const audioSequence = [];
    const hundreds = parseInt(orderNumber[0], 10);
    const tens = parseInt(orderNumber[1], 10);
    const ones = parseInt(orderNumber[2], 10);

    // 백의 자리
    if (hundreds > 0) {
        audioSequence.push(`./voice/${hundreds * 100}.mp3`);
    }

    // 십의 자리
    if (tens > 0) {
        audioSequence.push(`./voice/${tens * 10}.mp3`);
    }

    // 일의 자리
    if (ones > 0) {
        audioSequence.push(`./voice/${ones}.mp3`);
    }

    // 마지막 접 - '연동되었습니다' 등
    audioSequence.push('./voice/LAST.mp3');

    console.log('[DID] 주문번호 ' + orderNumber + ' 음성 스싱:', audioSequence);
    playAudioSequence(audioSequence);
}

let currentAudioIndex = 0;
let audioPlaylist = [];

function playAudioSequence(fileList) {
    if (!Array.isArray(fileList) || fileList.length === 0)
        return;

    audioPlaylist = fileList;
    currentAudioIndex = 0;
    playNextAudio();
}

function playNextAudio() {
    if (currentAudioIndex >= audioPlaylist.length) {
        console.log('[DID] 음성 재생 스싱 종료');
        return;
    }

    const audioPath = audioPlaylist[currentAudioIndex];
    const audio = new Audio(audioPath);
    audio.volume = 1;

    audio.onended = () => {
        currentAudioIndex++;
        // 50ms 간격으로 다음 재생 (자연스러운 연속 음성)
        setTimeout(playNextAudio, 50);
    };

    audio.onerror = (error) => {
        console.error('[DID] 음성 재생 실패:', audioPath, error);
        currentAudioIndex++;
        setTimeout(playNextAudio, 50);
    };

    try {
        audio.play().catch((error) => {
            console.warn('[DID] 음성 play() 실패:', error);
        });
    } catch (error) {
        console.error('[DID] 음성 실패:', error);
        currentAudioIndex++;
        setTimeout(playNextAudio, 50);
    }
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

    const newReadyOrders = hasInitialDisplayLoad
        ? ready.filter((orderNumber) => !currentData.ready.includes(orderNumber))
        : [];
    const hasNewReady = newReadyOrders.length > 0;
    currentData = { waiting, ready };

    // 준비중 목록 업데이트
    renderOrderCards(waitingList, waiting, 'waiting');

    // 준비완료 목록 업데이트
    renderOrderCards(readyList, ready, 'ready');

    if (hasNewReady) {
        playDingSound(() => {
            announceReadyOrders(newReadyOrders);
        });
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

function setupAudioUnlock() {
    const unlock = () => {
        if (soundUnlocked || !dingAudio)
            return;

        dingAudio.muted = false;
        const playPromise = dingAudio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                soundUnlocked = true;
                dingAudio.pause();
                dingAudio.currentTime = 0;
            }).catch((error) => {
                console.warn('[DID] 오디오 잠금 해제 실패:', error);
            });
        }
    };

    ['click', 'touchstart', 'keydown'].forEach((eventName) => {
        document.addEventListener(eventName, unlock, { once: true, passive: true });
    });
}

function createDingAudio() {
    let audio = document.getElementById('dingAudio');
    if (!audio) {
        audio = new Audio(DING_SOUND_URL);
        audio.id = 'dingAudio';
        document.body.appendChild(audio);
    }

    audio.preload = 'auto';
    audio.muted = true;
    audio.volume = 1;
    audio.loop = false;
    try {
        audio.load();
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.catch(() => {
                // muted autoplay may still be blocked; this is just to register the audio element
            });
        }
    } catch (error) {
        console.warn('[DID] 오디오 초기화 실패:', error);
    }

    return audio;
}

function playDingSound(onComplete) {
    if (!dingAudio)
        dingAudio = createDingAudio();

    if (!dingAudio) {
        if (typeof onComplete === 'function')
            onComplete();
        return;
    }

    try {
        dingAudio.muted = false;
        dingAudio.currentTime = 0;
        dingAudio.onended = () => {
            console.log('[DID] 띵동 재생 완료');
            if (typeof onComplete === 'function')
                onComplete();
        };

        const playPromise = dingAudio.play();
        if (playPromise !== undefined) {
            playPromise.catch((error) => {
                console.warn('[DID] 띵동 소리 재생 실패:', error);
                if (typeof onComplete === 'function')
                    onComplete();
            });
        }
    } catch (error) {
        console.warn('[DID] 띵동 소리 재생 중 예외 발생:', error);
        if (typeof onComplete === 'function')
            onComplete();
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
