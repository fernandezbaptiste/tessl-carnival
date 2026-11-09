import { describe, expect, it } from 'vitest';
import {
  BIG_BLIND,
  BUY_IN,
  act,
  bestHand,
  botAction,
  canRaise,
  changeRaise,
  createState,
  handName,
  leave,
  startHand,
  yourRaise,
} from './game';

// Cards are rank + 13 * suit, with rank 0 a two and rank 12 an ace.
const card = (rank: number, suit = 0) => rank + 13 * suit;
const totalChips = (state: ReturnType<typeof createState>) =>
  state.players.reduce((sum, p) => sum + p.chips + p.inPot, 0);

describe('poker tent', () => {
  it('seats you and three bots with 500 chips each and posts the blinds', () => {
    const state = createState(() => 0.5);
    expect(state.players).toHaveLength(4);
    expect(totalChips(state)).toBe(4 * BUY_IN);
    expect(state.currentBet).toBe(BIG_BLIND);
    expect(state.players.every((p) => p.cards.length === 2)).toBe(true);
  });

  it('names hands and ranks them in the usual order', () => {
    const flush = bestHand([card(0), card(4), card(6), card(8), card(11)]);
    const straight = bestHand([card(3, 1), card(4), card(5), card(6), card(7, 2)]);
    const wheel = bestHand([card(12, 1), card(0), card(1), card(2), card(3, 2)]);
    const pairOfAces = bestHand([card(12), card(12, 1), card(0), card(1), card(2, 2)]);
    const pairOfKings = bestHand([card(11), card(11, 1), card(5), card(6), card(7, 2)]);
    expect(handName(flush)).toBe('Flush');
    expect(handName(straight)).toBe('Straight');
    expect(handName(wheel)).toBe('Straight');
    expect(flush).toBeGreaterThan(straight);
    expect(straight).toBeGreaterThan(wheel);
    expect(pairOfAces).toBeGreaterThan(pairOfKings);
  });

  it('picks the best five of seven cards', () => {
    const hand = [card(12), card(12, 1), card(12, 2), card(5), card(5, 1), card(0, 3), card(1)];
    expect(handName(bestHand(hand))).toBe('Full house');
  });

  it('gives the pot to the last player when everyone else folds', () => {
    const state = createState(() => 0.5);
    while (state.phase === 'betting') act(state, 'fold');
    expect(state.phase).toBe('handOver');
    expect(state.players.filter((p) => !p.folded)).toHaveLength(1);
    expect(totalChips(state)).toBe(4 * BUY_IN);
  });

  it('deals the board and shows down when everyone checks it through', () => {
    const state = createState(() => 0.5);
    while (state.phase === 'betting') act(state, 'call');
    expect(state.board).toHaveLength(5);
    expect(state.shown).toBe(true);
    expect(totalChips(state)).toBe(4 * BUY_IN);
  });

  it('keeps every chip on the table through many hands of bot play', () => {
    let seed = 1;
    const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const state = createState(rng);
    for (let hand = 0; hand < 200 && state.phase !== 'busted'; hand++) {
      for (let moves = 0; state.phase === 'betting' && moves < 200; moves++)
        act(state, botAction(state));
      expect(state.phase).not.toBe('betting');
      const refills = state.players.slice(1).filter((p) => p.chips === 0).length;
      const before = totalChips(state);
      if (state.phase === 'handOver') startHand(state);
      expect(totalChips(state)).toBe(before + refills * BUY_IN);
    }
  });

  it('ends the session when you run out of chips', () => {
    const state = createState(() => 0.5);
    state.players[0].chips = 0;
    while (state.phase === 'betting') act(state, state.turn === 0 ? 'fold' : 'call');
    expect(state.phase).toBe('busted');
  });

  it('lets you leave whenever you like with the chips in front of you', () => {
    const state = createState(() => 0.5);
    leave(state);
    expect(state.phase).toBe('left');
    expect(state.message).toContain(String(state.players[0].chips));
  });

  it('counts the big blind as the first of four bets before the flop', () => {
    const state = createState(() => 0.5);
    while (state.phase === 'betting' && canRaise(state, state.players[state.turn]))
      act(state, 'raise');
    expect(state.currentBet).toBe(4 * BIG_BLIND);
  });

  it("doesn't reopen the betting for a short all-in raise", () => {
    const state = createState(() => 0.5);
    // The turn, with seats 1 and 3 left in and seat 3 holding 25 chips.
    Object.assign(state, { street: 2, currentBet: 0, raises: 0, turn: 1 });
    for (const p of state.players) Object.assign(p, { bet: 0, acted: false });
    state.players[0].folded = state.players[2].folded = true;
    state.players[3].chips = 25;
    act(state, 'raise');
    act(state, 'raise');
    expect(state.players[3].bet).toBe(25);
    expect(state.raises).toBe(1);
    expect(state.turn).toBe(1);
    expect(canRaise(state, state.players[1])).toBe(false);
  });

  it('reopens the betting when short all-ins add up to half a bet', () => {
    const state = createState(() => 0.5);
    // The turn, with seats 1 and 2 holding 25 and 30 chips.
    Object.assign(state, { street: 2, currentBet: 0, raises: 0, turn: 0 });
    for (const p of state.players) Object.assign(p, { bet: 0, acted: false, chips: 100 });
    state.players[1].chips = 25;
    state.players[2].chips = 30;
    act(state, 'raise');
    act(state, 'raise');
    act(state, 'raise');
    act(state, 'call');
    expect(state.players.map((p) => p.bet)).toEqual([20, 25, 30, 30]);
    expect(state.raises).toBe(1);
    expect(state.turn).toBe(0);
    expect(canRaise(state, state.players[0])).toBe(true);
  });

  it('gives the odd chip of a split pot to the first winner left of the button', () => {
    const state = createState(() => 0.5);
    // Seats 0 and 2 tie on the board, and the pot is 55 after seats 1 and 3 fold.
    state.board = [card(12), card(11, 1), card(10, 2), card(9, 3), card(8)];
    state.players[0].cards = [card(0, 1), card(1, 2)];
    state.players[2].cards = [card(0, 2), card(1, 3)];
    state.players.forEach((p, i) => Object.assign(p, { chips: 100, inPot: [20, 5, 20, 10][i] }));
    state.players[1].folded = state.players[3].folded = true;
    Object.assign(state, { dealer: 0, street: 3, turn: 0, currentBet: 0 });
    state.players[0].acted = state.players[2].acted = true;
    act(state, 'call');
    expect(state.players[2].chips).toBe(128);
    expect(state.players[0].chips).toBe(127);
  });

  it('lets you raise by more than one bet, and counts it as one raise', () => {
    const state = createState(() => 0.5);
    // You're on the button: Wild Bill calls the big blind of 10, then it's your turn.
    act(state, 'call');
    expect(state.turn).toBe(0);
    act(state, 'raise', 5 * BIG_BLIND);
    expect(state.players[0].bet).toBe(60);
    expect(state.currentBet).toBe(60);
    expect(state.raises).toBe(2);
    expect(state.message).toContain('to 60');
    expect(totalChips(state)).toBe(4 * BUY_IN);
  });

  it('never raises by less than one bet', () => {
    const state = createState(() => 0.5);
    act(state, 'raise', 1);
    expect(state.currentBet).toBe(2 * BIG_BLIND);
  });

  it('goes all in when the raise is more than you have', () => {
    const state = createState(() => 0.5);
    act(state, 'call');
    act(state, 'raise', 10 * BUY_IN);
    expect(state.players[0].chips).toBe(0);
    expect(state.currentBet).toBe(BUY_IN);
  });

  it('steps your raise up and down by whole bets, between one bet and all in', () => {
    const state = createState(() => 0.5);
    expect(yourRaise(state)).toBe(BIG_BLIND);
    changeRaise(state, -1);
    expect(yourRaise(state)).toBe(BIG_BLIND);
    changeRaise(state, 1);
    changeRaise(state, 1);
    expect(yourRaise(state)).toBe(3 * BIG_BLIND);
    changeRaise(state, 100);
    // You have 500 and owe 10 to call, so 490 more is all in.
    expect(yourRaise(state)).toBe(BUY_IN - BIG_BLIND);
    act(state, 'call');
    act(state, 'raise', yourRaise(state));
    expect(state.players[0].chips).toBe(0);
  });

  it('starts your raise at one bet again on each new street', () => {
    const state = createState(() => 0.5);
    changeRaise(state, 3);
    while (state.phase === 'betting' && state.street === 0) act(state, 'call');
    expect(state.street).toBe(1);
    expect(yourRaise(state)).toBe(BIG_BLIND);
  });
});
