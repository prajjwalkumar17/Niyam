const sections = Array.from(document.querySelectorAll('.chapter[data-section]'));
const reveals = Array.from(document.querySelectorAll('.reveal'));
const navLinks = Array.from(document.querySelectorAll('.chapter-link'));
const progressBar = document.getElementById('progress-bar');

const bodyClassBySection = {
    hero: 'section-chaos',
    failures: 'section-chaos',
    diagnosis: 'section-chaos',
    chain: 'section-control',
    proof: 'section-proof',
    modes: 'section-proof',
    hook: 'section-proof',
    close: 'section-close'
};

function updateProgress() {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = scrollable > 0 ? window.scrollY / scrollable : 0;
    progressBar.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
}

function setActiveSection(sectionId) {
    navLinks.forEach((link) => {
        link.classList.toggle('active', link.dataset.section === sectionId);
    });

    document.body.classList.remove('section-chaos', 'section-control', 'section-proof', 'section-close');
    const bodyClass = bodyClassBySection[sectionId];
    if (bodyClass) {
        document.body.classList.add(bodyClass);
    }
}

const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            revealObserver.unobserve(entry.target);
        }
    });
}, {
    threshold: 0.2,
    rootMargin: '0px 0px -10% 0px'
});

reveals.forEach((node) => revealObserver.observe(node));

const sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

    if (!visible) {
        return;
    }

    setActiveSection(visible.target.dataset.section);
}, {
    threshold: [0.2, 0.35, 0.6]
});

sections.forEach((section) => sectionObserver.observe(section));

const incidentStage = document.querySelector('[data-incident-stage]');

if (incidentStage) {
    const statusNode = incidentStage.querySelector('[data-incident-status]');
    const contextNode = incidentStage.querySelector('[data-incident-context]');
    const warningCard = incidentStage.querySelector('[data-incident-warning]');
    const warningKickerNode = incidentStage.querySelector('[data-incident-warning-kicker]');
    const warningTitleNode = incidentStage.querySelector('[data-incident-warning-title]');
    const warningBodyNode = incidentStage.querySelector('[data-incident-warning-body]');
    const footerLeftNode = incidentStage.querySelector('[data-incident-footer-left]');
    const footerRightNode = incidentStage.querySelector('[data-incident-footer-right]');
    const clusters = Array.from(incidentStage.querySelectorAll('[data-cluster]'));
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const phases = [
        {
            time: '00:00 / 00:08',
            status: 'operator thinks: one cluster',
            context: 'context: prod-eu',
            warningKicker: 'what the operator meant',
            warningTitle: 'clean one cluster',
            warningBody: 'what the shell executed: a region-wide delete path',
            footerLeft: 'approval window: skipped',
            footerRight: 'audit certainty: post-incident only',
            hot: [],
            alert: false
        },
        {
            time: '00:02 / 00:08',
            status: 'command accepted at face value',
            context: 'context: prod-eu',
            warningKicker: 'missing step',
            warningTitle: 'no risk simulation',
            warningBody: 'no one sees the blast radius before Enter is pressed',
            footerLeft: 'policy preview: unavailable',
            footerRight: 'approval gate: bypassed',
            hot: ['eu'],
            alert: false
        },
        {
            time: '00:04 / 00:08',
            status: 'fan-out begins',
            context: 'context: prod-eu + shared namespaces',
            warningKicker: 'scope mismatch',
            warningTitle: 'one cleanup became two',
            warningBody: 'the delete path is no longer confined to the intended cluster',
            footerLeft: 'execution mode: direct shell',
            footerRight: 'approvers: none',
            hot: ['eu', 'us'],
            alert: true
        },
        {
            time: '00:06 / 00:08',
            status: 'cross-region impact',
            context: 'context: prod-eu, prod-us, prod-apac',
            warningKicker: 'blast radius',
            warningTitle: 'three clusters affected',
            warningBody: 'the shell interpreted --all-namespaces literally across production',
            footerLeft: 'recovery plan: post-incident',
            footerRight: 'audit trail: after the fact',
            hot: ['eu', 'us', 'apac'],
            alert: true
        }
    ];

    let phaseIndex = 0;
    let intervalId = null;

    function applyPhase(index) {
        const phase = phases[index];
        statusNode.textContent = phase.status;
        contextNode.textContent = phase.context;
        warningKickerNode.textContent = phase.warningKicker;
        warningTitleNode.textContent = phase.warningTitle;
        warningBodyNode.textContent = phase.warningBody;
        footerLeftNode.textContent = phase.footerLeft;
        footerRightNode.textContent = phase.footerRight;
        warningCard.classList.toggle('is-alert', phase.alert);

        clusters.forEach((cluster) => {
            cluster.classList.toggle('is-hot', phase.hot.includes(cluster.dataset.cluster));
        });
    }

    function startIncidentLoop() {
        if (intervalId || reduceMotion.matches) {
            return;
        }

        intervalId = window.setInterval(() => {
            phaseIndex = (phaseIndex + 1) % phases.length;
            applyPhase(phaseIndex);
        }, 2000);
    }

    function stopIncidentLoop() {
        if (intervalId) {
            window.clearInterval(intervalId);
            intervalId = null;
        }
    }

    reduceMotion.addEventListener('change', (event) => {
        if (event.matches) {
            stopIncidentLoop();
            phaseIndex = 0;
            applyPhase(phaseIndex);
        } else {
            applyPhase(phaseIndex);
            startIncidentLoop();
        }
    });

    applyPhase(phaseIndex);
    startIncidentLoop();
}

window.addEventListener('scroll', updateProgress, { passive: true });
window.addEventListener('resize', updateProgress);

updateProgress();
setActiveSection('hero');
