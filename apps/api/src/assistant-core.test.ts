import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAssistantMessage as parse } from './assistant-core.js';
test('voice commands preserve artist spelling and embedded command substrings', () => {
 for (const name of ['Stromae', 'The National', 'Кишлак', 'Молодой Рубль', 'n01r']) {
  assert.equal(parse(`найди ${name}`).query, name);
 }
 assert.equal(parse('включи Daft Punk Get Lucky').query, 'Daft Punk Get Lucky');
});
test('Russian mood mixes and personal requests', () => {
 assert.equal(parse('микс для тренировки').label, 'Энергия');
 assert.equal(parse('микс для тренировки').action, 'create_playlist');
 assert.equal(parse('мой микс по моим вкусам').action, 'explain');
 assert.equal(parse('подбери спокойную музыку').label, 'Спокойствие');
 assert.equal(parse('привет').action, 'greeting');
});
