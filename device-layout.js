(function () {
    function isPhoneLike() {
        const ua = navigator.userAgent.toLowerCase();
        const mobileUA = /mobi|iphone|ipod|android|blackberry|iemobile|windows phone|opera mini/.test(ua);
        const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
        const shortEdge = Math.min(window.innerWidth, window.innerHeight);
        const compactScreen = shortEdge <= 600;
        const phoneLandscape = window.matchMedia('(orientation: landscape) and (max-height: 520px) and (pointer: coarse)').matches;

        return mobileUA || phoneLandscape || (coarsePointer && compactScreen);
    }

    function isTabletUA() {
        const ua = navigator.userAgent.toLowerCase();
        return /tablet|ipad|playbook|silk|android(?!.*mobile)/.test(ua);
    }

    function detectDeviceType() {
        if (isPhoneLike())
            return 'mobile';
        if (isTabletUA())
            return 'tablet';
        return 'desktop';
    }

    function updateAspectLayout() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const aspectRatio = width / height;
        let layoutType;

        if (aspectRatio >= 1.5)
            layoutType = 'landscape-wide';
        else if (aspectRatio >= 1.33)
            layoutType = 'landscape';
        else
            layoutType = 'portrait';

        document.documentElement.setAttribute('data-aspect-layout', layoutType);
    }

    function applyDeviceLayout() {
        const deviceType = detectDeviceType();
        document.documentElement.setAttribute('data-device', deviceType);
        document.documentElement.classList.toggle('is-mobile-phone', deviceType === 'mobile');
        updateAspectLayout();
        console.log(`[DID] 디바이스: ${deviceType}, ${window.innerWidth}x${window.innerHeight}`);
    }

    applyDeviceLayout();
    window.addEventListener('resize', applyDeviceLayout);
    window.addEventListener('orientationchange', () => {
        window.setTimeout(applyDeviceLayout, 100);
    });

    window.DeviceLayout = {
        apply: applyDeviceLayout,
        detect: detectDeviceType
    };
})();
