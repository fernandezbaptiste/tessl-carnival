# Poker Tent

A Texas hold'em cash game against three bots: Tight Tina, Loose Lou and Wild Bill.

## How to play

- Everyone buys in for 500 chips. The blinds are 5 and 10, and the button moves
  one seat each hand.
- The usual hold'em rules apply: two cards each, then the flop, the turn and the
  river, with a round of betting before each and after the river. The best five
  of your seven cards wins the pot, and all-in players win side pots in the usual way.
- A bet is 10 before the turn and 20 on the turn and river, and a raise adds at
  least one bet on top of the call. You can raise by more: any whole number of
  bets, up to all in. The bots always raise by one bet. There are at most four
  bets a street, however big each one is. Before the flop the big blind counts
  as the first bet. An all-in raise of less than half a bet
  doesn't count as a raise, and players who already acted can only call it,
  unless short all-ins together raise the bet they face by half a bet or more.
- In a split pot, an odd chip goes to the first winner to the left of the button.
- When it's your turn, click **Fold**, **Check** or **Call**, or **Raise**. Click
  **+** and **-** beside **Raise** to raise by a bet more or less; when your raise
  would use all your chips, the button says **All in**. Your raise goes back to
  one bet each street. Click **Deal** for the next hand.
- It's a cash game: click **Leave** whenever you want to cash out. Chips you have
  already put in the current pot stay there. A bot that goes broke is replaced by
  a fresh bot with 500 chips.
- If you run out of chips, the session ends. Click to buy in again.

## Scoring

Your score is the chips you leave with: the chips in front of you when you click
**Leave**, or 0 if you go broke. It's saved to the carnival's score board when
the session ends.

## Files

- `game.ts`: the game logic (`createState`, `startHand`, `act`, `changeRaise`,
  `botAction`, `bestHand`, `leave`) and the `pokerTent` entry, the default export the midway finds.
- `game.test.ts`: tests for the game logic.
