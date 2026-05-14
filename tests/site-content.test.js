const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function readPage(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('about page does not include the founders section', () => {
  const about = readPage('about.html');

  assert.equal(about.includes('founders-section'), false);
  assert.equal(about.includes('OUR FOUNDERS'), false);
  assert.equal(about.includes('Founder 1'), false);
});

test('events page renders event-driven registration forms', () => {
  const events = readPage('events.html');

  [
    'id="registration-modal"',
    'id="registration-fields"',
    'data-register-event',
    'activeRegistrationEvent',
    'renderRegistrationFields',
    'registrationPayload'
  ].forEach(text => assert.ok(events.includes(text), `${text} missing from events page`));

  assert.equal(events.includes('docs.google.com/forms'), false);
});

test('admin events page includes a registration form builder', () => {
  const adminEvents = readPage('admin-events.html');

  [
    'id="reg-enabled"',
    'id="reg-payment-required"',
    'id="reg-payment-link"',
    'id="reg-builder"',
    'addRegistrationQuestion',
    'collectRegistrationConfig',
    'defaultRegistrationQuestions'
  ].forEach(text => assert.ok(adminEvents.includes(text), `${text} missing from admin events page`));
});

test('supabase schema supports event registration forms and submissions', () => {
  const schema = readPage('supabase/schema.sql');

  [
    'registration jsonb',
    'create table if not exists public.registrations',
    'Public can submit registrations',
    'Admins can read registrations'
  ].forEach(text => assert.ok(schema.includes(text), `${text} missing from Supabase schema`));
});
