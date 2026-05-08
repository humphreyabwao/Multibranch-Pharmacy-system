/**
 * Sidebar + login branding — scoped per branch (businessId) in localStorage.
 */
(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    var LAST_BIZ_KEY = 'pf_last_active_business_id';

    function snapshotKey(businessId) {
        return 'pf_brand_snapshot_' + businessId;
    }

    function safeHttpUrl(u) {
        if (!u || typeof u !== 'string') return '';
        var s = u.trim();
        if (/^https:\/\//i.test(s)) return s;
        if (/^http:\/\//i.test(s)) return s;
        return '';
    }

    function readSnapshot(businessId) {
        if (!businessId) return null;
        try {
            var raw = localStorage.getItem(snapshotKey(businessId));
            if (!raw) return null;
            var o = JSON.parse(raw);
            if (!o || typeof o !== 'object') return null;
            return o;
        } catch (e) {
            return null;
        }
    }

    /** Flat keys from before per-branch snapshots (read once as fallback). */
    function readLegacySnapshot() {
        try {
            var name = localStorage.getItem('pf_brand_name');
            if (!name) return null;
            return {
                name: name,
                tagline: localStorage.getItem('pf_brand_tagline') || '',
                icon: localStorage.getItem('pf_brand_icon') || 'fas fa-capsules',
                companyLogo: localStorage.getItem('pf_brand_company_logo') || ''
            };
        } catch (e) {
            return null;
        }
    }

    /**
     * @param {string} [businessId] — defaults to pf_last_active_business_id
     */
    function getResolvedSnapshot(businessId) {
        var bid = businessId || (function () {
            try { return localStorage.getItem(LAST_BIZ_KEY); } catch (e) { return null; }
        })();
        var snap = readSnapshot(bid);
        if (snap) return snap;
        if (!bid) return readLegacySnapshot();
        return null;
    }

    function persistBranchSnapshot(businessId, business) {
        if (!businessId || !business) return;
        try {
            localStorage.setItem(LAST_BIZ_KEY, businessId);
            var payload = {
                name: business.name || '',
                tagline: business.tagline || '',
                icon: business.logoIcon || 'fas fa-capsules',
                companyLogo: business.companyLogoUrl || ''
            };
            localStorage.setItem(snapshotKey(businessId), JSON.stringify(payload));
        } catch (e) { /* ignore */ }
    }

    function applySidebar(logoUrl, iconClass) {
        var wrap = document.querySelector('.sidebar-logo');
        if (!wrap) return;
        var url = safeHttpUrl(logoUrl);
        var iconEl = wrap.querySelector('i');
        var imgEl = wrap.querySelector('.sidebar-logo-img');
        if (url) {
            if (!imgEl) {
                imgEl = document.createElement('img');
                imgEl.className = 'sidebar-logo-img';
                imgEl.alt = '';
                wrap.insertBefore(imgEl, wrap.firstChild);
            }
            imgEl.src = url;
            if (iconEl) iconEl.style.display = 'none';
        } else {
            if (imgEl) imgEl.remove();
            if (iconEl) {
                iconEl.style.display = '';
                if (iconClass) iconEl.className = iconClass;
            }
        }
    }

    function applyLogin(logoUrl, iconClass) {
        var box = document.querySelector('.login-logo');
        if (!box) return;
        var url = safeHttpUrl(logoUrl);
        box.classList.remove('login-logo-has-img');
        if (url) {
            box.innerHTML = '';
            var img = document.createElement('img');
            img.className = 'login-logo-img';
            img.alt = '';
            img.src = url;
            box.appendChild(img);
            box.classList.add('login-logo-has-img');
        } else {
            box.innerHTML = '';
            var i = document.createElement('i');
            i.className = iconClass || 'fas fa-capsules';
            box.appendChild(i);
        }
    }

    function applyChromeFromSnapshot(snap) {
        if (!snap) return;
        if (snap.name) {
            document.title = snap.name + ' - ' + (snap.tagline || 'Pharmacy Management System');
            var logoText = document.querySelector('.logo-text');
            if (logoText) logoText.textContent = snap.name;
            var topbarTitle = document.querySelector('.topbar-title');
            if (topbarTitle) topbarTitle.textContent = snap.name;
        }
        if (snap.icon) {
            var logoIcon = document.querySelector('.sidebar-logo > i');
            if (logoIcon) logoIcon.className = snap.icon;
        }
        applySidebar(snap.companyLogo, snap.icon || 'fas fa-capsules');
    }

    /**
     * @param {string} [businessId]
     */
    function applyFromLocalStorage(businessId) {
        try {
            var snap = getResolvedSnapshot(businessId);
            if (!snap) return;
            applySidebar(snap.companyLogo, snap.icon || 'fas fa-capsules');
        } catch (e) { /* ignore */ }
    }

    /**
     * Title + topbar + sidebar (e.g. settings boot, index inline).
     * @param {string} [businessId]
     */
    function applyChromeFromLocalStorage(businessId) {
        try {
            var snap = getResolvedSnapshot(businessId);
            if (!snap) return;
            applyChromeFromSnapshot(snap);
        } catch (e) { /* ignore */ }
    }

    function applyLoginPageFromLocalStorage() {
        var snap = getResolvedSnapshot();
        if (!snap) snap = readLegacySnapshot();
        if (!snap) {
            applyLogin('', 'fas fa-capsules');
            return null;
        }
        applyLogin(snap.companyLogo, snap.icon || 'fas fa-capsules');
        return { name: snap.name || '', tagline: snap.tagline || '' };
    }

    window.PharmaFlow.BrandingSync = {
        LAST_BIZ_KEY: LAST_BIZ_KEY,
        snapshotKey: snapshotKey,
        getResolvedSnapshot: getResolvedSnapshot,
        persistBranchSnapshot: persistBranchSnapshot,
        applySidebar: applySidebar,
        applyLogin: applyLogin,
        applyFromLocalStorage: applyFromLocalStorage,
        applyChromeFromLocalStorage: applyChromeFromLocalStorage,
        applyLoginPageFromLocalStorage: applyLoginPageFromLocalStorage
    };
})();
