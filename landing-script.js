// Landing Page Animations and Interactions

// Smooth scroll para navegação
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  });
});

// Animação de scroll para revelar elementos
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -100px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, observerOptions);

// Animar cards ao aparecer
document.querySelectorAll('.feature-card, .pricing-card').forEach(card => {
  card.style.opacity = '0';
  card.style.transform = 'translateY(30px)';
  card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
  observer.observe(card);
});

// Animação do mockup de sequenciador
function animateSequencer() {
  const steps = document.querySelectorAll('.mock-step');
  let currentStep = 0;

  setInterval(() => {
    // Remover active de todos
    steps.forEach(step => step.classList.remove('active'));

    // Ativar padrão
    const pattern = [0, 4, 8, 12, 1, 5, 9, 13];
    pattern.forEach(index => {
      if (index === currentStep || index === currentStep + 16) {
        steps[index]?.classList.add('active');
      }
    });

    currentStep = (currentStep + 1) % 8;
  }, 300);
}

// Iniciar animação do sequenciador
if (document.querySelector('.mock-step')) {
  animateSequencer();
}

// Demo video placeholder
const videoPlaceholder = document.querySelector('.video-placeholder');
if (videoPlaceholder) {
  videoPlaceholder.addEventListener('click', () => {
    // Aqui você pode adicionar a lógica para abrir um modal com vídeo
    alert('Vídeo demo em breve! Por enquanto, acesse o app clicando em "Começar Agora"');
  });
}

// Efeito parallax suave nas orbs
window.addEventListener('mousemove', (e) => {
  const moveX = (e.clientX - window.innerWidth / 2) / 50;
  const moveY = (e.clientY - window.innerHeight / 2) / 50;

  document.querySelectorAll('.gradient-orb').forEach((orb, index) => {
    const speed = (index + 1) * 0.5;
    orb.style.transform = `translate(${moveX * speed}px, ${moveY * speed}px)`;
  });
});

// Navbar com fundo ao scroll
window.addEventListener('scroll', () => {
  const navbar = document.querySelector('.navbar');
  if (window.scrollY > 100) {
    navbar.style.background = 'rgba(3, 0, 20, 0.9)';
    navbar.style.backdropFilter = 'blur(20px)';
    navbar.style.borderBottom = '1px solid rgba(255, 255, 255, 0.1)';
  } else {
    navbar.style.background = 'transparent';
    navbar.style.backdropFilter = 'none';
    navbar.style.borderBottom = 'none';
  }
});

// Adicionar transição suave ao navbar
const navbar = document.querySelector('.navbar');
navbar.style.transition = 'all 0.3s ease';

// Estatísticas animadas
function animateValue(element, start, end, duration) {
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const value = Math.floor(progress * (end - start) + start);
    element.textContent = value >= 1000 ? `${(value / 1000).toFixed(1)}K+` : `${value}+`;
    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  };
  window.requestAnimationFrame(step);
}

// Animar estatísticas quando visíveis
const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const statNumbers = entry.target.querySelectorAll('.stat-number');
      statNumbers.forEach((stat, index) => {
        const text = stat.textContent;
        if (text.includes('10K')) {
          stat.textContent = '0';
          animateValue(stat, 0, 10000, 2000);
        } else if (text.includes('500K')) {
          stat.textContent = '0';
          animateValue(stat, 0, 500000, 2000);
        } else if (text.includes('4.9')) {
          let count = 0;
          const interval = setInterval(() => {
            count += 0.1;
            stat.textContent = `${count.toFixed(1)}★`;
            if (count >= 4.9) clearInterval(interval);
          }, 100);
        }
      });
      statsObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });

const heroStats = document.querySelector('.hero-stats');
if (heroStats) {
  statsObserver.observe(heroStats);
}

// Atualiza contagem de ritmos do manifest (fonte única, evita hardcode desatualizado)
fetch('/rhythm/manifest.json')
  .then(r => r.json())
  .then(m => {
    const n = Array.isArray(m?.rhythms) ? m.rhythms.length : null;
    if (!n) return;
    document.querySelectorAll('.js-rhythm-count').forEach(el => { el.textContent = String(n); });
  })
  .catch(() => { /* fallback do HTML fica válido */ });

console.log('🎵 GDrums Landing Page loaded successfully!');
