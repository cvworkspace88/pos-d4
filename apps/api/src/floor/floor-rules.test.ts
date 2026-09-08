import assert from 'node:assert/strict';
import test from 'node:test';
import { HAS_BOOKED, UNMERGE_FIRST, rejectDelete, rejectMerge } from './floor-rules.ts';

const t = (id: string, mergedIntoId: string | null = null) => ({ id, mergedIntoId });

// A: standalone. B: standalone. H: head of {M}. M: member of H.
const A = t('A');
const B = t('B');
const H = t('H');
const M = t('M', 'H');
const ALL = [A, B, H, M];

test('two standalone tables can merge', () => {
  assert.equal(rejectMerge(A, [B], ALL), null);
});

test('an existing head can take another standalone member', () => {
  assert.equal(rejectMerge(H, [A], ALL), null);
});

test('a member cannot be a head', () => {
  assert.equal(rejectMerge(M, [A], ALL), UNMERGE_FIRST);
});

test('a member cannot join another group', () => {
  assert.equal(rejectMerge(A, [M], ALL), UNMERGE_FIRST);
});

test('a head cannot become a member — one level only', () => {
  assert.equal(rejectMerge(A, [H], ALL), UNMERGE_FIRST);
});

test('one bad member rejects the whole merge', () => {
  assert.equal(rejectMerge(A, [B, M], ALL), UNMERGE_FIRST);
});

test('a standalone table with no booked reservation can be deleted', () => {
  assert.equal(rejectDelete(A, ALL, [{ tableId: 'A', status: 'seated' }]), null);
});

test('a head cannot be deleted', () => {
  assert.equal(rejectDelete(H, ALL, []), UNMERGE_FIRST);
});

test('a member cannot be deleted', () => {
  assert.equal(rejectDelete(M, ALL, []), UNMERGE_FIRST);
});

test('a booked reservation blocks delete', () => {
  assert.equal(rejectDelete(A, ALL, [{ tableId: 'A', status: 'booked' }]), HAS_BOOKED);
});

test('a booked reservation on another table does not', () => {
  assert.equal(rejectDelete(A, ALL, [{ tableId: 'B', status: 'booked' }]), null);
});

test('merge wins over reservation when both block', () => {
  assert.equal(rejectDelete(M, ALL, [{ tableId: 'M', status: 'booked' }]), UNMERGE_FIRST);
});
