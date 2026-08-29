// data/stratagems-data.js — the core 10e stratagems (rulebook, every army).
//
// These live in a DATA module, not in a feature module: the Build-mode
// "Army rules & stratagems" panel (ui/faction-rules.js) and the printable
// data cards (ui/cards-mode.js) both read App.CORE_STRATAGEMS, and they
// outlived the Stratagem Browser modal that used to own this array.
// Descriptions are original short paraphrases of the well-known core strats.
(function () {
  const App = window.App = window.App || {};

    App.CORE_STRATAGEMS = [
    {
      name: 'Command Re-roll',
      description: 'Use this Stratagem in any phase, just after you have made a Hit roll, a Wound roll, a Damage roll, a saving throw, an Advance roll, a Charge roll, a Battle-shock test or a roll to determine the number of attacks made with a weapon, for a unit from your army. Re-roll that roll.',
      cp: 1,
      phase: 'Any',
      type: 'core',
    },
    {
      name: 'Counter-Offensive',
      description: 'Use this Stratagem in your opponent’s Fight phase, just after an enemy unit has fought. Select one unit from your army that is within Engagement Range of one or more enemy units; that unit fights next.',
      cp: 2,
      phase: 'Fight',
      type: 'core',
    },
    {
      name: 'Tank Shock',
      description: 'Use this Stratagem in your Charge phase, after a Vehicle unit from your army ends a Charge move. Select one enemy unit within Engagement Range of that Vehicle and roll a number of D6 equal to that Vehicle’s Toughness. For each 5+, the enemy unit takes 1 mortal wound (to a maximum of 6).',
      cp: 1,
      phase: 'Charge',
      type: 'core',
    },
    {
      name: 'Heroic Intervention',
      description: 'Use this Stratagem in your opponent’s Charge phase, just after an enemy unit ends a Charge move. Select one Character unit from your army within 6" of that enemy unit and not within Engagement Range of any enemy units. That Character can move up to 6" in any direction, ignoring vertical distance, but must end the move within Engagement Range of that enemy unit.',
      cp: 2,
      phase: 'Charge',
      type: 'core',
    },
    {
      name: 'Insane Bravery',
      description: 'Use this Stratagem in any phase, just before taking a Battle-shock test for a unit from your army. That test is automatically passed. You can only use this Stratagem once per battle.',
      cp: 1,
      phase: 'Any',
      type: 'core',
    },
    {
      name: 'Go to Ground',
      description: 'Use this Stratagem in your opponent’s Shooting phase, just after an enemy unit has selected its targets. Select one Infantry unit from your army that was selected as a target. Until the end of the phase, all models in that unit have a 6+ invulnerable save and the Benefit of Cover, but the unit can only make Normal moves until the end of your next turn.',
      cp: 1,
      phase: 'Shooting',
      type: 'core',
    },
    {
      name: 'Smokescreen',
      description: 'Use this Stratagem in your opponent’s Shooting phase, just after an enemy unit has selected its targets. Select one unit from your army with the Smoke keyword that was selected as a target. Until the end of the phase, each time a ranged attack targets that unit, subtract 1 from the Hit roll and the target has the Benefit of Cover.',
      cp: 1,
      phase: 'Shooting',
      type: 'core',
    },
    {
      name: 'Fire Overwatch',
      description: 'Use this Stratagem in your opponent’s Movement or Charge phase, when an enemy unit is declared as moving, deploying or charging within 24" of and visible to a unit from your army. Until the end of the phase, that friendly unit can shoot the enemy unit as if it were your Shooting phase, but an unmodified Hit roll of 6 is required to score a hit, regardless of weapon Ballistic Skill.',
      cp: 1,
      phase: 'Movement',
      type: 'core',
    },
  ];
})();
