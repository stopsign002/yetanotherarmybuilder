// data/stratagems-data.js — the ten 11e core stratagems (rulebook, every army).
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
      description: 'Use this Stratagem in any phase, just after you make an Advance roll, a Charge roll, a Damage roll, a Hazard roll, a Hit roll, a Save roll, a Wound roll, or a roll to determine the number of attacks generated with a weapon, for a friendly unit or model. Select that unit or model. Re-roll that roll; if you are rolling more than one dice together, select one of those dice to re-roll, except a Charge roll, which you must re-roll in full.',
      cp: 1,
      phase: 'Any',
      type: 'core',
    },
    {
      name: 'Counteroffensive',
      description: 'Use this Stratagem in the Fight step of your opponent’s Fight phase, just after an enemy unit has resolved its attacks. Select one friendly unit that is eligible to fight. Until the end of the phase, your unit has the Fights First ability and it must be the next unit you select to fight.',
      cp: 2,
      phase: 'Fight',
      type: 'core',
    },
    {
      name: 'Epic Challenge',
      description: 'Use this Stratagem in the Fight phase, just after a friendly Character unit is selected to fight. Select that Character unit. Select one Character model in your unit; until the end of the phase, that model’s melee weapons have the [Precision] ability.',
      cp: 1,
      phase: 'Fight',
      type: 'core',
    },
    {
      name: 'Insane Bravery',
      description: 'Use this Stratagem in the Battle-shock step of your Command phase, just before you make a Battle-shock roll for a friendly unit. Select that unit. That Battle-shock roll is automatically successful. You cannot use this Stratagem more than once per battle.',
      cp: 1,
      phase: 'Command',
      type: 'core',
    },
    {
      name: 'Crushing Impact',
      description: 'Use this Stratagem in your Charge phase, just after a friendly Monster/Vehicle unit ends a Charge move. Select that Monster/Vehicle unit. Select one enemy unit engaged with your unit, then select one model in your unit engaged with that enemy unit. Roll a number of D6 equal to that model’s Toughness characteristic: for each 1, your unit suffers 1 mortal wound; for each 5+, that enemy unit suffers 1 mortal wound, to a maximum of 6 mortal wounds per unit.',
      cp: 1,
      phase: 'Charge',
      type: 'core',
    },
    {
      name: 'Explosives',
      description: 'Use this Stratagem in your Shooting phase. Select one friendly unengaged Explosives/Grenades unit that is eligible to shoot and did not make an Advance move this turn. Select one Explosives/Grenades model in your unit, then select one unengaged enemy unit within 8" of and visible to that model. Roll six D6: for each 4+, that enemy unit suffers 1 mortal wound.',
      cp: 1,
      phase: 'Shooting',
      type: 'core',
    },
    {
      name: 'Rapid Ingress',
      description: 'Use this Stratagem at the end of your opponent’s Movement phase. Select one friendly unit that is in strategic reserves, excluding Aircraft units. Your unit makes an ingress move. You cannot use this Stratagem during the first battle round.',
      cp: 1,
      phase: 'Movement',
      type: 'core',
    },
    {
      name: 'Fire Overwatch',
      description: 'Use this Stratagem at the end of your opponent’s Movement phase. Select one friendly unengaged unit, excluding Titanic units. Your unit shoots using snap shooting.',
      cp: 1,
      phase: 'Movement',
      type: 'core',
    },
    {
      name: 'Smokescreen',
      description: 'Use this Stratagem at the start of your opponent’s Shooting phase. Select one friendly Smoke unit. Until the end of the phase, each time an attack targets either your Smoke unit, or a unit that is not fully visible to the attacking model because of one or more models in your Smoke unit, the target has the benefit of cover against that attack.',
      cp: 1,
      phase: 'Shooting',
      type: 'core',
    },
    {
      name: 'Heroic Intervention',
      description: 'Use this Stratagem at the end of your opponent’s Charge phase. Select one friendly unengaged unit within 12" of one or more enemy units; you can only select a Vehicle unit if it is a Character or Walker unit. Resolve a charge with your unit, selecting one of two modes before making the charge roll: Leap to Defend, in which you can only select charge targets that made a Charge move this phase and are within the maximum distance; or, for +1CP, Into the Fray, in which any charge roll greater than 6 (after modifiers) becomes 6, and you can select charge targets among any enemy units within 6" of your unit and within the maximum distance.',
      cp: 1,
      phase: 'Charge',
      type: 'core',
    },
  ];
})();
