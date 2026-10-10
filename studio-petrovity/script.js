(() => {
  'use strict';
  const CONTACT_EMAIL = 'hello@yourdomain.com';
  document.querySelectorAll('[data-contact-email]').forEach((link) => {
    link.href = 'mailto:' + CONTACT_EMAIL;
    link.textContent = CONTACT_EMAIL + ' ↗';
  });

  const projects = {
    pixel: ['Slow Days', 'PIXEL ART / MOTION STUDY', 'PERSONAL CONCEPT', 'A tiny world built around slowing down: warm window light, rain on the glass, and a room that feels lived in. The looping autumn-room animation is used as a real media asset.'],
    bloom: ['Bloom Objects', 'E-COMMERCE / ART DIRECTION', 'SPECULATIVE CONCEPT', 'A considered storefront concept for everyday objects. Natural tones, generous spacing and playful accents make browsing feel calm rather than crowded.'],
    mori: ['Mori', 'MOBILE UI / PRODUCT CONCEPT', 'SPECULATIVE CONCEPT', 'A small-screen concept for a gentler daily-planning experience, with clear hierarchy, comfortable controls and a warm visual language.'],
    overview: ['Work with intention', 'WEB / BRAND / MOTION', 'SELECTED CONCEPTS', 'These examples are concept work, not claims of commissioned client projects. The same process can shape a real brief: define the goal, find a distinct point of view, design the system and build the experience responsively.']
  };
  const dialog = document.getElementById('case-dialog');
  const byId = (id) => document.getElementById(id);
  document.querySelectorAll('[data-project]').forEach((button) => {
    button.addEventListener('click', () => {
      const data = projects[button.dataset.project];
      if (!data || !dialog) return;
      byId('dialog-title').textContent = data[0];
      byId('dialog-type').textContent = data[1];
      byId('dialog-status').textContent = data[2];
      byId('dialog-body').textContent = data[3];
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else window.alert(data[0] + '\n\n' + data[3]);
    });
  });
  byId('dialog-contact-link')?.addEventListener('click', () => { if (dialog.open) dialog.close(); });
  dialog?.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealNodes = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reducedMotion) {
    const observer = new IntersectionObserver((entries, current) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); current.unobserve(entry.target); }
    }), { threshold: 0.12 });
    revealNodes.forEach((node) => observer.observe(node));
  } else revealNodes.forEach((node) => node.classList.add('is-visible'));
  if (reducedMotion) document.querySelectorAll('.pixel-video').forEach((video) => { video.pause(); video.removeAttribute('autoplay'); });

  const formEl = byId('contact-form');
  if (!formEl) return;
  const status = byId('form-status');
  const errors = { name: byId('name-error'), email: byId('email-error'), message: byId('message-error') };
  const setError = (field, message) => {
    const control = formEl.elements[field];
    errors[field].textContent = message;
    control.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (message) control.setAttribute('aria-describedby', field + '-error');
    else control.removeAttribute('aria-describedby');
  };
  formEl.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = new FormData(formEl);
    const name = String(values.get('name') || '').trim();
    const email = String(values.get('email') || '').trim();
    const project = String(values.get('project') || '').trim();
    const message = String(values.get('message') || '').trim();
    let valid = true;
    if (name.length < 2) { setError('name', 'Please enter at least 2 characters.'); valid = false; } else setError('name', '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setError('email', 'Please enter a valid email address.'); valid = false; } else setError('email', '');
    if (message.length < 10) { setError('message', 'Please add at least 10 characters.'); valid = false; } else setError('message', '');
    const projectControl = formEl.elements.project;
    if (!project) { projectControl.setAttribute('aria-invalid', 'true'); status.textContent = 'Please choose a project type.'; valid = false; }
    else projectControl.removeAttribute('aria-invalid');
    if (!valid) {
      status.textContent = 'Please check the highlighted fields and try again.';
      formEl.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    if (CONTACT_EMAIL === 'hello@yourdomain.com') {
      status.textContent = 'The form is valid, but the inbox still needs to be configured. No message has been sent.';
      return;
    }
    const subject = encodeURIComponent('Website enquiry — ' + project);
    const body = encodeURIComponent('Name: ' + name + '\nReply email: ' + email + '\nProject: ' + project + '\n\n' + message);
    status.textContent = 'Your email app will open with the message prepared. It has not been sent yet; review and send it there.';
    window.location.href = 'mailto:' + CONTACT_EMAIL + '?subject=' + subject + '&body=' + body;
  });
})();