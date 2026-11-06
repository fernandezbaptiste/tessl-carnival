import { canvasFont, recordScore, theme, type CarnivalGame } from '../../carnival';

const { width: WIDTH, height: HEIGHT } = theme.canvas;

export const BUY_IN = 500;
export const SMALL_BLIND = 5;
export const BIG_BLIND = 10;
/** Fixed limit: at most a bet and three raises on each street. The big blind is the pre-flop bet. */
export const MAX_RAISES = 4;
const BOT_DELAY = 0.7;
const STREETS = ['Pre-flop', 'Flop', 'Turn', 'River'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['♠', '♥', '♦', '♣'];
export const HAND_NAMES = [
  'High card',
  'Pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
];

export type Style = 'you' | 'tight' | 'loose' | 'wild';
export type Action = 'fold' | 'call' | 'raise';

/** How each seat plays: it folds below `fold` strength and raises above `raise`. */
const STYLES: Record<Style, { fold: number; raise: number }> = {
  you: { fold: 0.3, raise: 0.8 },
  tight: { fold: 0.45, raise: 0.85 },
  loose: { fold: 0.2, raise: 0.8 },
  wild: { fold: 0.1, raise: 0.55 },
};

export interface Player {
  name: string;
  style: Style;
  chips: number;
  /** Cards are 0 to 51: rank is card % 13 (0 is a two), suit is card / 13. */
  cards: number[];
  /** Chips put in on this street, and in the whole hand. */
  bet: number;
  inPot: number;
  folded: boolean;
  acted: boolean;
}

export interface PokerState {
  players: Player[];
  deck: number[];
  board: number[];
  dealer: number;
  turn: number;
  street: number;
  currentBet: number;
  raises: number;
  /** The bet after the last full raise. A seat that already acted at this level may only call. */
  fullBet: number;
  phase: 'betting' | 'handOver' | 'busted' | 'left';
  /** True when the hand went to a showdown, so the bots' cards are shown. */
  shown: boolean;
  message: string;
  rng: () => number;
}

export function createState(rng: () => number = Math.random): PokerState {
  const seat = (name: string, style: Style): Player => ({
    name,
    style,
    chips: BUY_IN,
    cards: [],
    bet: 0,
    inPot: 0,
    folded: false,
    acted: false,
  });
  const state: PokerState = {
    players: [
      seat('You', 'you'),
      seat('Tight Tina', 'tight'),
      seat('Loose Lou', 'loose'),
      seat('Wild Bill', 'wild'),
    ],
    deck: [],
    board: [],
    dealer: 3,
    turn: 0,
    street: 0,
    currentBet: 0,
    raises: 0,
    fullBet: 0,
    phase: 'betting',
    shown: false,
    message: '',
    rng,
  };
  startHand(state);
  return state;
}

/** Scores the best five of the cards: higher is better, and the category is score / 13^5. */
export function bestHand(cards: number[]): number {
  let best = -1;
  const pick = (start: number, chosen: number[]) => {
    if (chosen.length === 5) best = Math.max(best, rateFive(chosen));
    else for (let i = start; i < cards.length; i++) pick(i + 1, [...chosen, cards[i]]);
  };
  pick(0, []);
  return best;
}

export const handName = (score: number) => HAND_NAMES[Math.floor(score / 13 ** 5)];

function rateFive(cards: number[]): number {
  const ranks = cards.map((c) => c % 13).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((c) => Math.floor(c / 13) === Math.floor(cards[0] / 13));
  const wheel = groups.length === 5 && ranks[0] === 12 && ranks[1] === 3;
  const straight = groups.length === 5 && (ranks[0] - ranks[4] === 4 || wheel);
  const shape = groups.map((g) => g[1]).join('');
  const category =
    straight && flush
      ? 8
      : shape === '41'
        ? 7
        : shape === '32'
          ? 6
          : flush
            ? 5
            : straight
              ? 4
              : shape === '311'
                ? 3
                : shape === '221'
                  ? 2
                  : shape === '2111'
                    ? 1
                    : 0;
  const kickers = straight ? [wheel ? 3 : ranks[0]] : groups.map((g) => g[0]);
  return [...kickers, 0, 0, 0, 0].slice(0, 5).reduce((score, r) => score * 13 + r, category);
}

/** Deals a new hand: moves the button, posts the blinds and refills any bot that went broke. */
export function startHand(state: PokerState): void {
  for (const p of state.players) {
    // A cash game: a new bot buys in when one goes broke.
    if (p.style !== 'you' && p.chips === 0) p.chips = BUY_IN;
    Object.assign(p, { cards: [], bet: 0, inPot: 0, folded: false, acted: false });
  }
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(state.rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const n = state.players.length;
  state.deck = deck;
  state.board = [];
  state.dealer = (state.dealer + 1) % n;
  for (const p of state.players) p.cards = [deck.pop()!, deck.pop()!];
  Object.assign(state, {
    street: 0,
    raises: 1,
    fullBet: BIG_BLIND,
    phase: 'betting',
    shown: false,
  });
  pay(state, (state.dealer + 1) % n, SMALL_BLIND);
  pay(state, (state.dealer + 2) % n, BIG_BLIND);
  state.currentBet = BIG_BLIND;
  state.turn = (state.dealer + 2) % n;
  state.message = 'New hand. Blinds are 5 and 10.';
  nextTurn(state);
}

export const betSize = (state: PokerState) => (state.street < 2 ? BIG_BLIND : BIG_BLIND * 2);
export const owed = (state: PokerState, p: Player) => state.currentBet - p.bet;
export const canRaise = (state: PokerState, p: Player) =>
  state.raises < MAX_RAISES && p.chips > owed(state, p) && !(p.acted && p.bet >= state.fullBet);

function pay(state: PokerState, seat: number, amount: number) {
  const p = state.players[seat];
  const paid = Math.min(amount, p.chips);
  p.chips -= paid;
  p.bet += paid;
  p.inPot += paid;
}

const waiting = (state: PokerState, p: Player) =>
  !p.folded && p.chips > 0 && (!p.acted || p.bet < state.currentBet);

function nextTurn(state: PokerState) {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const seat = (state.turn + i) % n;
    if (waiting(state, state.players[seat])) return void (state.turn = seat);
  }
}

/** The player whose turn it is folds, checks or calls, or raises. A free fold is a check. */
export function act(state: PokerState, action: Action): void {
  if (state.phase !== 'betting') return;
  const p = state.players[state.turn];
  const due = owed(state, p);
  if (action === 'raise' && canRaise(state, p)) {
    pay(state, state.turn, due + betSize(state));
    // An all-in raise of less than half a bet doesn't count as a raise or reopen the betting.
    if ((p.bet - state.currentBet) * 2 >= betSize(state)) {
      state.raises += 1;
      state.fullBet = p.bet;
    }
    state.currentBet = Math.max(state.currentBet, p.bet);
    state.message = `${p.name} raises to ${p.bet}`;
  } else if (action === 'fold' && due > 0) {
    p.folded = true;
    state.message = `${p.name} folds`;
  } else {
    pay(state, state.turn, due);
    state.message = due > 0 ? `${p.name} calls ${due}` : `${p.name} checks`;
  }
  p.acted = true;
  advance(state);
}

function advance(state: PokerState) {
  const live = state.players.filter((p) => !p.folded);
  if (live.length === 1) return endHand(state);
  if (live.some((p) => waiting(state, p))) return nextTurn(state);
  if (state.street === 3 || live.filter((p) => p.chips > 0).length < 2) {
    while (state.board.length < 5) state.board.push(state.deck.pop()!);
    return endHand(state);
  }
  state.street += 1;
  const cards = state.street === 1 ? 3 : 1;
  for (let i = 0; i < cards; i++) state.board.push(state.deck.pop()!);
  for (const p of state.players) Object.assign(p, { bet: 0, acted: false });
  Object.assign(state, { currentBet: 0, raises: 0, fullBet: 0, turn: state.dealer });
  nextTurn(state);
}

function endHand(state: PokerState) {
  const n = state.players.length;
  // Seats in order from the left of the button, who get any odd chips first.
  const live = state.players
    .map((p, seat) => ({ p, from: (seat - state.dealer - 1 + n) % n }))
    .sort((a, b) => a.from - b.from)
    .map(({ p }) => p)
    .filter((p) => !p.folded);
  const pot = state.players.reduce((sum, p) => sum + p.inPot, 0);
  if (live.length === 1) {
    live[0].chips += pot;
    state.message = `${live[0].name} wins ${pot}`;
  } else {
    // Split each layer of the pot among the best hands that paid into all of it.
    const score = new Map(live.map((p) => [p, bestHand([...p.cards, ...state.board])]));
    const levels = [...new Set(live.map((p) => p.inPot))].sort((a, b) => a - b);
    let floor = 0;
    let paid = 0;
    const won = new Map<Player, number>();
    for (const level of levels) {
      const layer = state.players.reduce(
        (sum, p) => sum + Math.max(0, Math.min(p.inPot, level) - floor),
        0,
      );
      const eligible = live.filter((p) => p.inPot >= level);
      const top = Math.max(...eligible.map((p) => score.get(p)!));
      const winners = eligible.filter((p) => score.get(p) === top);
      winners.forEach((p, i) => {
        const share = Math.floor(layer / winners.length) + (i === 0 ? layer % winners.length : 0);
        p.chips += share;
        paid += share;
        won.set(p, (won.get(p) ?? 0) + share);
      });
      floor = level;
    }
    // Chips a folded player put in above every live player's stake go to the last winner.
    const last = [...won.keys()].at(-1)!;
    last.chips += pot - paid;
    won.set(last, won.get(last)! + pot - paid);
    state.message = [...won]
      .map(([p, chips]) => `${p.name} wins ${chips} with ${handName(score.get(p)!)}`)
      .join(', ');
    state.shown = true;
  }
  for (const p of state.players) Object.assign(p, { bet: 0, inPot: 0 });
  state.phase = state.players[0].chips === 0 ? 'busted' : 'handOver';
}

/** How good a seat's cards look, from 0 to about 1. */
export function handStrength(cards: number[], board: number[]): number {
  if (board.length === 0) {
    const [a, b] = cards.map((c) => c % 13);
    const suited = Math.floor(cards[0] / 13) === Math.floor(cards[1] / 13) ? 0.05 : 0;
    return a === b ? 0.5 + a / 24 : (a + b) / 24 + suited;
  }
  return Math.min(1, 0.2 + Math.floor(bestHand([...cards, ...board]) / 13 ** 5) * 0.2);
}

/** What the seat whose turn it is would do, by its style and a little luck. */
export function botAction(state: PokerState): Action {
  const p = state.players[state.turn];
  const strength = handStrength(p.cards, state.board);
  const style = STYLES[p.style];
  if (strength + state.rng() * 0.3 > style.raise) return 'raise';
  if (owed(state, p) > 0 && strength + state.rng() * 0.2 < style.fold) return 'fold';
  return 'call';
}

/** You cash out with the chips in front of you. Chips already in the pot stay there. */
export function leave(state: PokerState): void {
  if (state.phase === 'busted') return;
  state.phase = 'left';
  state.message = `You cashed out ${state.players[0].chips} chips`;
}

const yourTurn = (state: PokerState) => state.phase === 'betting' && state.turn === 0;

interface Button {
  label: string;
  x: number;
  run: (state: PokerState) => void;
}

function buttons(state: PokerState): Button[] {
  const you = state.players[0];
  const list: Button[] = [{ label: 'Leave', x: 16, run: leave }];
  if (state.phase === 'handOver') list.push({ label: 'Deal', x: 640, run: startHand });
  if (yourTurn(state)) {
    const due = owed(state, you);
    if (due > 0) list.push({ label: 'Fold', x: 400, run: (s) => act(s, 'fold') });
    const call = due > 0 ? `Call ${Math.min(due, you.chips)}` : 'Check';
    list.push({ label: call, x: 520, run: (s) => act(s, 'call') });
    if (canRaise(state, you)) {
      list.push({ label: `Raise ${betSize(state)}`, x: 640, run: (s) => act(s, 'raise') });
    }
  }
  return list;
}
const BUTTON = { y: HEIGHT - 52, w: 110, h: 36 };

const SEATS = [
  { x: WIDTH / 2, y: HEIGHT - 150 },
  { x: 110, y: 200 },
  { x: WIDTH / 2, y: 30 },
  { x: WIDTH - 110, y: 200 },
];

function drawCard(ctx: CanvasRenderingContext2D, x: number, y: number, card?: number) {
  const { colors } = theme;
  ctx.fillStyle = card === undefined ? colors.stripeA : colors.stripeB;
  ctx.beginPath();
  ctx.roundRect(x, y, 40, 56, 6);
  ctx.fill();
  if (card === undefined) return;
  const suit = Math.floor(card / 13);
  ctx.fillStyle = suit === 1 || suit === 2 ? colors.stripeA : colors.background;
  ctx.font = canvasFont('body', 'bold');
  ctx.textAlign = 'center';
  ctx.fillText(RANKS[card % 13], x + 20, y + 24);
  ctx.fillText(SUITS[suit], x + 20, y + 46);
}

function draw(ctx: CanvasRenderingContext2D, state: PokerState) {
  const { colors } = theme;
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // The table, a felt of the surface colour with a wooden rail.
  ctx.fillStyle = colors.wood;
  ctx.beginPath();
  ctx.ellipse(WIDTH / 2, 215, 310, 150, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colors.surface;
  ctx.beginPath();
  ctx.ellipse(WIDTH / 2, 215, 290, 132, 0, 0, Math.PI * 2);
  ctx.fill();

  state.board.forEach((card, i) => drawCard(ctx, WIDTH / 2 - 110 + i * 45, 170, card));
  const pot = state.players.reduce((sum, p) => sum + p.inPot, 0);
  ctx.fillStyle = colors.accent;
  ctx.font = canvasFont('body', 'bold');
  ctx.textAlign = 'center';
  ctx.fillText(`${STREETS[state.street]}  ·  Pot ${pot}`, WIDTH / 2, 150);
  ctx.fillStyle = colors.text;
  ctx.font = canvasFont('small');
  ctx.fillText(state.message, WIDTH / 2, 255);

  state.players.forEach((p, i) => {
    const { x, y } = SEATS[i];
    const faceUp = i === 0 || (state.shown && !p.folded);
    if (!p.folded)
      p.cards.forEach((card, c) => drawCard(ctx, x - 42 + c * 44, y, faceUp ? card : undefined));
    const active = state.phase === 'betting' && state.turn === i;
    ctx.fillStyle = p.folded ? colors.muted : active ? colors.accent : colors.text;
    ctx.font = canvasFont('small', 'bold');
    ctx.textAlign = 'center';
    const dealer = state.dealer === i ? ' (D)' : '';
    ctx.fillText(`${p.name}${dealer}: ${p.chips}`, x, y + 74);
    if (p.bet > 0) ctx.fillText(`Bet ${p.bet}`, x, y + 92);
  });

  for (const b of buttons(state)) {
    ctx.fillStyle = b.label === 'Leave' ? colors.danger : colors.accent;
    ctx.beginPath();
    ctx.roundRect(b.x, BUTTON.y, BUTTON.w, BUTTON.h, theme.radius);
    ctx.fill();
    ctx.fillStyle = colors.background;
    ctx.font = canvasFont('body', 'bold');
    ctx.textAlign = 'center';
    ctx.fillText(b.label, b.x + BUTTON.w / 2, BUTTON.y + 24);
  }

  if (state.phase === 'busted' || state.phase === 'left') {
    ctx.fillStyle = colors.background;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.fillStyle = colors.accent;
    ctx.font = canvasFont('title', 'bold');
    const title = state.phase === 'busted' ? 'Out of chips!' : state.message;
    ctx.fillText(title, WIDTH / 2, HEIGHT / 2);
    ctx.fillStyle = colors.text;
    ctx.font = canvasFont('body');
    ctx.fillText('Click to buy in again', WIDTH / 2, HEIGHT / 2 + 40);
  }
}

export const pokerTent: CarnivalGame = {
  id: 'poker-tent',
  name: 'Poker Tent',
  description: "Texas hold'em against three bots. Buy in for 500 and cash out whenever you like.",

  start(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    let state = createState();
    let scoreRecorded = false;
    // Saves the score once, as soon as the session ends, before a restart or teardown drops it.
    const saveScore = () => {
      if ((state.phase === 'busted' || state.phase === 'left') && !scoreRecorded) {
        recordScore(pokerTent.id, state.players[0].chips);
        scoreRecorded = true;
      }
    };

    const onDown = (event: PointerEvent) => {
      if (state.phase === 'busted' || state.phase === 'left') {
        saveScore();
        state = createState();
        scoreRecorded = false;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
      const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
      const hit = buttons(state).find(
        (b) => x >= b.x && x <= b.x + BUTTON.w && y >= BUTTON.y && y <= BUTTON.y + BUTTON.h,
      );
      hit?.run(state);
      saveScore();
    };
    canvas.addEventListener('pointerdown', onDown);

    let frame = 0;
    let wait = 0;
    let last = performance.now();
    const loop = (time: number) => {
      const dt = Math.min((time - last) / 1000, 0.05);
      last = time;
      if (state.phase === 'betting' && !yourTurn(state)) {
        wait += dt;
        if (wait >= BOT_DELAY) {
          wait = 0;
          act(state, botAction(state));
          saveScore();
        }
      }
      draw(ctx, state);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      saveScore();
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', onDown);
    };
  },
};

export default pokerTent;
