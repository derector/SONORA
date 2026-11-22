import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playbackCommand } from './assistant-commands';
test('normalizes whole spoken commands, preserves music search', () => {
 assert.equal(playbackCommand(' Пауза! '), 'pause');
 assert.equal(playbackCommand('Слушать   подборку.'), 'mix');
 assert.equal(playbackCommand('продолжить'), 'resume');
 for (const name of ['Найди Пауза', 'Включи Стоп', 'Микс для тренировки']) assert.equal(playbackCommand(name), null);
});
