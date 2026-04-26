// data/stratagems-data.js — original (non-GW-copyrighted) sample stratagems by faction & detachment.
(function () {
  const App = window.App = window.App || {};

  App.STRATAGEMS_DATA = {
    factions: {
      'Space Marines': [
        {
          name: 'Coordinated Volley',
          cp: 1,
          phase: 'Shooting',
          description: 'WHEN: Your Shooting phase. TARGET: One Adeptus Astartes Infantry unit from your army that has not moved this turn. EFFECT: Until end of phase, that unit\'s ranged weapons gain [LETHAL HITS].'
        },
        {
          name: 'Primaris Resolve',
          cp: 1,
          phase: 'Command',
          description: 'WHEN: Start of any phase. TARGET: One Adeptus Astartes unit from your army. EFFECT: Until end of phase, that unit can ignore any or all modifiers to its characteristics and to Hit rolls.'
        },
        {
          name: 'Honour the Codex',
          cp: 2,
          phase: 'Movement',
          description: 'WHEN: Your Movement phase. TARGET: One Adeptus Astartes unit that arrives from Reserves this phase. EFFECT: That unit can shoot in your following Shooting phase even if it Advanced.'
        },
        {
          name: 'Brother-Captain\'s Wrath',
          cp: 1,
          phase: 'Fight',
          description: 'WHEN: Fight phase. TARGET: One Adeptus Astartes Character from your army. EFFECT: Until end of phase, that model\'s melee weapons have [SUSTAINED HITS 1].'
        },
        {
          name: 'Hold the Line',
          cp: 1,
          phase: 'Shooting',
          description: 'WHEN: Your opponent\'s Shooting phase, after a unit selects targets. TARGET: One Adeptus Astartes Infantry unit from your army that was selected as the target. EFFECT: Until end of phase, models in that unit have a 4+ invulnerable save against ranged attacks.'
        }
      ],
      'Tyranids': [
        {
          name: 'Living Shield',
          cp: 1,
          phase: 'Shooting',
          description: 'WHEN: Your opponent\'s Shooting phase. TARGET: One Tyranids Monster within 6" of a friendly Tyranids Infantry unit. EFFECT: Until end of phase, attacks against the Monster suffer -1 to wound while the screening unit lives.'
        },
        {
          name: 'Endless Swarm',
          cp: 2,
          phase: 'Command',
          description: 'WHEN: Command phase. TARGET: One Tyranids Battleline unit from your army that has been destroyed this battle. EFFECT: Place that unit at half strength wholly within 6" of a board edge in your deployment zone.'
        },
        {
          name: 'Synaptic Surge',
          cp: 1,
          phase: 'Movement',
          description: 'WHEN: Your Movement phase. TARGET: One Tyranids unit within Synapse range. EFFECT: That unit can make a Normal move of up to 6" before any other movement this phase.'
        },
        {
          name: 'Feed',
          cp: 1,
          phase: 'Fight',
          description: 'WHEN: Fight phase. TARGET: One Tyranids unit from your army that destroyed an enemy unit this turn. EFFECT: That unit regains up to D3 lost wounds, distributed as you choose.'
        },
        {
          name: 'Unnatural Resilience',
          cp: 2,
          phase: 'Any',
          description: 'WHEN: Any phase. TARGET: One Tyranids Monster from your army that has just lost wounds. EFFECT: Roll a D6 for each wound just lost; on a 5+, that wound is ignored.'
        }
      ],
      'Necrons': [
        {
          name: 'Reanimating Protocols',
          cp: 1,
          phase: 'Command',
          description: 'WHEN: Command phase. TARGET: One Necrons unit from your army with the Reanimation Protocols ability. EFFECT: Until end of turn, that unit\'s Reanimation Protocols restore 2 wounds per roll instead of 1.'
        },
        {
          name: 'Phase Shift',
          cp: 2,
          phase: 'Movement',
          description: 'WHEN: Your opponent\'s Movement or Charge phase. TARGET: One Necrons Infantry unit from your army. EFFECT: Remove that unit and place it in Strategic Reserves; it returns next turn from any board edge.'
        },
        {
          name: 'Cold Logic',
          cp: 1,
          phase: 'Shooting',
          description: 'WHEN: Your Shooting phase. TARGET: One Necrons unit from your army. EFFECT: Until end of phase, that unit\'s ranged weapons re-roll Hit rolls of 1.'
        },
        {
          name: 'Implacable Advance',
          cp: 1,
          phase: 'Movement',
          description: 'WHEN: Your Movement phase. TARGET: One Necrons Infantry unit from your army. EFFECT: That unit may make a Normal move and still shoot as if it had Remained Stationary this turn.'
        }
      ],
      'Orks': [
        {
          name: 'Get Stuck In',
          cp: 1,
          phase: 'Charge',
          description: 'WHEN: Your Charge phase. TARGET: One Orks unit that just declared a charge. EFFECT: Add 2 to that unit\'s Charge roll.'
        },
        {
          name: 'More Dakka',
          cp: 1,
          phase: 'Shooting',
          description: 'WHEN: Your Shooting phase. TARGET: One Orks unit from your army. EFFECT: Until end of phase, that unit\'s ranged weapons gain [SUSTAINED HITS 1].'
        },
        {
          name: 'Waaagh! Energy',
          cp: 2,
          phase: 'Fight',
          description: 'WHEN: Fight phase. TARGET: One Orks unit from your army within Engagement Range of an enemy unit. EFFECT: Until end of phase, that unit\'s melee weapons have +1 Strength and +1 Attacks.'
        },
        {
          name: 'Tellyporta',
          cp: 1,
          phase: 'Movement',
          description: 'WHEN: Your Movement phase. TARGET: One Orks Infantry unit in Strategic Reserves. EFFECT: That unit arrives anywhere on the table more than 9" from any enemy unit.'
        },
        {
          name: 'Mob Up',
          cp: 1,
          phase: 'Command',
          description: 'WHEN: Command phase. TARGET: Two friendly Orks Infantry units of the same datasheet within 6" of each other. EFFECT: Combine those units into one for the rest of the battle.'
        }
      ],
      'Aeldari': [
        {
          name: 'Fleet of Foot',
          cp: 1,
          phase: 'Movement',
          description: 'WHEN: Your Movement phase. TARGET: One Aeldari Infantry unit from your army. EFFECT: That unit may Advance and still shoot Assault weapons; add 3 to its Advance roll.'
        },
        {
          name: 'Matchless Agility',
          cp: 1,
          phase: 'Shooting',
          description: 'WHEN: Your opponent\'s Shooting phase. TARGET: One Aeldari unit from your army that was selected as the target. EFFECT: Until end of phase, the targeting unit subtracts 1 from Hit rolls against the target.'
        },
        {
          name: 'Pinpoint Volley',
          cp: 2,
          phase: 'Shooting',
          description: 'WHEN: Your Shooting phase. TARGET: One Aeldari unit from your army. EFFECT: Until end of phase, that unit\'s ranged attacks have [PRECISION].'
        },
        {
          name: 'Path of the Warrior',
          cp: 1,
          phase: 'Fight',
          description: 'WHEN: Fight phase. TARGET: One Aeldari Aspect Warrior unit. EFFECT: Until end of phase, that unit\'s melee attacks have [LETHAL HITS].'
        }
      ],
      'Chaos Space Marines': [
        {
          name: 'Dark Hospitality',
          cp: 1,
          phase: 'Fight',
          description: 'WHEN: Fight phase. TARGET: One Heretic Astartes unit from your army within Engagement Range of an enemy unit. EFFECT: Until end of phase, melee attacks made by that unit re-roll Wound rolls of 1.'
        },
        {
          name: 'Profane Zeal',
          cp: 1,
          phase: 'Charge',
          description: 'WHEN: Your Charge phase. TARGET: One Heretic Astartes unit that just successfully charged. EFFECT: Until end of turn, that unit\'s melee weapons have +1 Strength.'
        },
        {
          name: 'Whispered Curse',
          cp: 2,
          phase: 'Command',
          description: 'WHEN: Command phase. TARGET: One enemy unit within 18" of a Heretic Astartes Character from your army. EFFECT: Until your next Command phase, that enemy unit subtracts 1 from Battle-shock tests.'
        },
        {
          name: 'Eternal Hatred',
          cp: 1,
          phase: 'Shooting',
          description: 'WHEN: Your Shooting phase. TARGET: One Heretic Astartes unit. EFFECT: Until end of phase, ranged attacks against Adeptus Astartes units re-roll Wound rolls of 1.'
        }
      ],
      'Adeptus Mechanicus': [
        {
          name: 'Doctrina Imperatives',
          cp: 1,
          phase: 'Shooting',
          description: 'WHEN: Your Shooting phase. TARGET: One Adeptus Mechanicus Infantry unit from your army. EFFECT: Until end of phase, that unit gains +1 to Hit rolls but suffers -1 to its Save characteristic this turn.'
        },
        {
          name: 'Binharic Override',
          cp: 1,
          phase: 'Command',
          description: 'WHEN: Command phase. TARGET: One Adeptus Mechanicus unit from your army within 6" of a Tech-Priest. EFFECT: That unit ignores any modifiers to its characteristics until your next Command phase.'
        },
        {
          name: 'Galvanic Volley',
          cp: 2,
          phase: 'Shooting',
          description: 'WHEN: Your Shooting phase. TARGET: One Skitarii unit from your army that has not moved this turn. EFFECT: Until end of phase, that unit\'s Galvanic-class weapons have [LETHAL HITS] and [SUSTAINED HITS 1].'
        },
        {
          name: 'Refit Protocol',
          cp: 1,
          phase: 'Command',
          description: 'WHEN: Command phase. TARGET: One Adeptus Mechanicus Vehicle from your army within 3" of a Tech-Priest. EFFECT: That Vehicle regains up to D3 lost wounds.'
        }
      ],
      'T\'au Empire': [
        {
          name: 'Combined Firing Solution',
          cp: 1,
          phase: 'Shooting',
          description: 'WHEN: Your Shooting phase. TARGET: One T\'au Empire unit from your army targeting an enemy unit already shot at this phase. EFFECT: Until end of phase, that unit gains +1 to Hit rolls against that target.'
        },
        {
          name: 'Photon Suppression',
          cp: 1,
          phase: 'Movement',
          description: 'WHEN: Your opponent\'s Movement phase. TARGET: One T\'au Empire unit from your army. EFFECT: Until end of turn, enemy units within 12" subtract 1 from Charge rolls and Advance rolls.'
        },
        {
          name: 'Kauyon Patience',
          cp: 2,
          phase: 'Shooting',
          description: 'WHEN: Your Shooting phase. TARGET: One T\'au Empire unit that has not moved this battle round. EFFECT: Until end of phase, that unit\'s ranged weapons have [LETHAL HITS] and [SUSTAINED HITS 1].'
        },
        {
          name: 'Mont\'ka Strike',
          cp: 1,
          phase: 'Movement',
          description: 'WHEN: Your Movement phase. TARGET: One T\'au Empire Battlesuit unit. EFFECT: That unit may make a Normal move of up to 6" and still shoot as if it had Remained Stationary.'
        }
      ]
    },
    detachments: {
      'Gladius Task Force': [
        {
          name: 'Codex Discipline',
          cp: 1,
          phase: 'Command',
          description: 'WHEN: Command phase. TARGET: One Adeptus Astartes unit. EFFECT: Until your next Command phase, that unit\'s Objective Control characteristic is increased by 1.'
        },
        {
          name: 'Combined Arms',
          cp: 2,
          phase: 'Shooting',
          description: 'WHEN: Your Shooting phase. TARGET: One Adeptus Astartes unit from your army. EFFECT: Until end of phase, ranged attacks targeting an enemy already wounded by another friendly unit this phase have +1 to wound.'
        },
        {
          name: 'Storm of Fire',
          cp: 1,
          phase: 'Shooting',
          description: 'WHEN: Your Shooting phase. TARGET: One Adeptus Astartes Infantry unit. EFFECT: Until end of phase, when targeting an objective the enemy controls, that unit\'s bolt weapons gain [SUSTAINED HITS 1].'
        }
      ],
      'Invasion Fleet': [
        {
          name: 'Hungering Tide',
          cp: 1,
          phase: 'Movement',
          description: 'WHEN: Your Movement phase. TARGET: One Tyranids unit. EFFECT: That unit may Advance and shoot Assault weapons in your following Shooting phase as though it had not Advanced.'
        },
        {
          name: 'Death From Above',
          cp: 1,
          phase: 'Movement',
          description: 'WHEN: Your Movement phase. TARGET: One Tyranids unit arriving from Reserves. EFFECT: That unit may set up more than 6" from any enemy unit instead of the usual 9".'
        },
        {
          name: 'Single-Minded Annihilation',
          cp: 2,
          phase: 'Charge',
          description: 'WHEN: Your Charge phase. TARGET: One Tyranids unit declaring a charge against an enemy character. EFFECT: That unit may re-roll its Charge roll and gains +1 to wound that character this turn.'
        }
      ],
      'Awakened Dynasty': [
        {
          name: 'Royal Decree',
          cp: 1,
          phase: 'Command',
          description: 'WHEN: Command phase. TARGET: One Necrons unit within 9" of a Necrons Character. EFFECT: Until your next Command phase, that unit can ignore modifiers to its Movement, Advance and Charge rolls.'
        },
        {
          name: 'Eternal Madness',
          cp: 2,
          phase: 'Fight',
          description: 'WHEN: Fight phase. TARGET: One Necrons Infantry unit within Engagement Range of an enemy unit. EFFECT: Until end of phase, that unit\'s melee weapons have +1 Attacks.'
        },
        {
          name: 'Hyperphasic Surge',
          cp: 1,
          phase: 'Movement',
          description: 'WHEN: Your Movement phase. TARGET: One Necrons unit. EFFECT: That unit can make a Normal move of up to 6" before any other movement this phase.'
        }
      ],
      'War Horde': [
        {
          name: 'Ere We Go!',
          cp: 1,
          phase: 'Charge',
          description: 'WHEN: Your Charge phase. TARGET: One Orks unit declaring a charge. EFFECT: Re-roll the Charge roll for that unit; if any of those dice are 6s, the unit also adds 1 to wound rolls in the following Fight phase.'
        },
        {
          name: 'Big Red Button',
          cp: 1,
          phase: 'Shooting',
          description: 'WHEN: Your Shooting phase. TARGET: One Orks Vehicle from your army. EFFECT: Until end of phase, one ranged weapon equipped on that Vehicle has +1 to its Damage characteristic.'
        },
        {
          name: 'Green Tide',
          cp: 2,
          phase: 'Movement',
          description: 'WHEN: Your Movement phase. TARGET: One Orks Battleline unit destroyed earlier this battle. EFFECT: Place that unit at half strength wholly within your deployment zone.'
        }
      ],
      'Battle Host': [
        {
          name: 'Shimmering Veil',
          cp: 1,
          phase: 'Shooting',
          description: 'WHEN: Your opponent\'s Shooting phase. TARGET: One Aeldari unit selected as the target of an attack. EFFECT: Until end of phase, that unit has the Benefit of Cover and a 5+ invulnerable save against ranged attacks.'
        },
        {
          name: 'Webway Strike',
          cp: 1,
          phase: 'Movement',
          description: 'WHEN: Your Movement phase. TARGET: One Aeldari Infantry unit in Strategic Reserves. EFFECT: That unit can be set up anywhere on the battlefield more than 6" from any enemy unit instead of 9".'
        },
        {
          name: 'Foresight',
          cp: 2,
          phase: 'Command',
          description: 'WHEN: Command phase. TARGET: One Aeldari unit from your army. EFFECT: Until your next Command phase, the first failed save for that unit each phase is automatically passed instead.'
        }
      ],
      'Chaos Warband': [
        {
          name: 'Boon of Mutation',
          cp: 1,
          phase: 'Command',
          description: 'WHEN: Command phase. TARGET: One Heretic Astartes Character that destroyed an enemy unit last turn. EFFECT: Roll a D6: 1-3 +1 Attacks until end of game; 4-5 +1 Strength; 6 both.'
        },
        {
          name: 'Vile Blessing',
          cp: 1,
          phase: 'Fight',
          description: 'WHEN: Fight phase. TARGET: One Heretic Astartes unit within Engagement Range of an enemy. EFFECT: Until end of phase, that unit\'s melee weapons have [DEVASTATING WOUNDS].'
        },
        {
          name: 'Forbidden Pact',
          cp: 2,
          phase: 'Movement',
          description: 'WHEN: Your Movement phase. TARGET: One Heretic Astartes unit. EFFECT: That unit can make a Normal, Advance, or Fall Back move and still shoot and charge in your following phases.'
        }
      ],
      'Skitarii Hunter Cohort': [
        {
          name: 'Hunter\'s Quarry',
          cp: 1,
          phase: 'Command',
          description: 'WHEN: Command phase. TARGET: Select one enemy unit. EFFECT: Until your next Command phase, friendly Skitarii units re-roll Hit rolls of 1 against that unit.'
        },
        {
          name: 'Doctrina Imperative: Ranged',
          cp: 1,
          phase: 'Shooting',
          description: 'WHEN: Your Shooting phase. TARGET: One Skitarii unit. EFFECT: Until end of phase, that unit gains +1 to Hit rolls; subtract 1 from Hit rolls of attacks targeting that unit until your next turn.'
        },
        {
          name: 'Tactical Recoordination',
          cp: 1,
          phase: 'Movement',
          description: 'WHEN: Your Movement phase. TARGET: One Skitarii Infantry unit. EFFECT: That unit can make a Normal move of up to 6" and gain the Benefit of Cover until your next turn.'
        }
      ],
      'Mont\'ka': [
        {
          name: 'Coordinated Strike',
          cp: 1,
          phase: 'Shooting',
          description: 'WHEN: Your Shooting phase. TARGET: One T\'au Empire unit. EFFECT: Until end of phase, that unit\'s ranged weapons gain [LETHAL HITS] when targeting an enemy already destroyed by another friendly unit this phase.'
        },
        {
          name: 'Decisive Action',
          cp: 1,
          phase: 'Movement',
          description: 'WHEN: Your Movement phase. TARGET: One T\'au Empire Battlesuit unit. EFFECT: That unit can make a Normal move of up to 6" and shoot in your following Shooting phase as if it had Remained Stationary.'
        },
        {
          name: 'Point-Blank Volley',
          cp: 2,
          phase: 'Shooting',
          description: 'WHEN: Your Shooting phase. TARGET: One T\'au Empire unit within 12" of a target enemy unit. EFFECT: Until end of phase, that unit\'s ranged attacks have +1 to wound.'
        }
      ]
    }
  };
})();
