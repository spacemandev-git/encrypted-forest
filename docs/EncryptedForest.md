# **Encrypted Forest**

Encrypted Forest is a game on the Solana blockchain that makes use of Arcium MPC network to provide gameplay featuring hidden information.

After a game creation admin has created a game with configured settings, players are able to spawn into a low level planet, explore the on chain fog of war, and attack other planets. This basic gameplay can be expanded on with various winning conditions like race for the center or king of the hill or other later stage mechanics.

The core implementation will feature three main components, the on chain programs interfacing with Arcium and Solana, the Svelte 5 based browser client with threejs for the game itself (and the ability to make transactions directly to the chain), and a typescript SDK that'll allow anyone to make clients/interact with the chain.

## **Gameplay**

The game centers around an admin configuring the size of a deployed map, then players being able to spawn into a given map by “searching” for a coordinate of a planet that fits spawn criteria. This is a compute intensive process, and the way they search for planets throughout the map. After they spawn, the planet they own generates “ships” continously until it hits some cap. They can send these “ships” to attack other planets, either neutral or owned by other players. If they reduce a rival planet’s “ships” to 0, they can claim it and once claimed it starts generating “ships” for them. Neutral planets usually have static number of ships spawned on them per their level, and enemy player planets usually have dynamic “ships” as they continously generate more.

### **Game Creator (Game Admin) Config**

The game creation admin (could be anyone that setups a game) configures the following:

- Start and end time of the instanced game.
- Size of the map (starting at 0,0 and going in all four directions until it hits the configured diameter).
- Fixed size planets outside of Perlin Noise Function. These can be marked visible or not by the admin as well, by ‘broadcasting’ their location when creating them at the start of the game (see actions below). The size is chosen by the admin.
- The win condition type, which can be one of various types (each which has it’s own configuration).
  - Points - Burning Metal
    - Players get x points per metal that they burn at a Spacetime Rip
    - The amount of points per metal is configurable
  - Race to the Center
    - Players all spawn a minimum distance away from the center of the map,
- If the game is whitelist or not. If it’s whitelisted, a server public key is registered and will be required for signing the create account instruction to allow the server to maintain and implement the whitelist.
- Game Speed which defaults to to 10000 as “normal” speed. Lower numbers will slow down things like generation and launch velocity (see Celestial Bodies below) and higher speeds will increase them.
- Perlin Noise Thresholds
  - What difficulty thresholds of hashes result in what size celestial bodies. Higher difficulties mean it’s harder to find a celestial body of that type, lower thresholds mean it’s easier.

### **Celestial Bodies**

There’s different kinds of celestial bodies that can be found in the game universe.

All of these types of celestial bodies have the following stats: - Size 1-6 (Miniscule, Tiny, Small, Medium, Large, Gargantuan) - Determined by perlin noise function based on (x,y) coordinate - Size determines starting generation speeds and capacities. - Capacities go up quadratically, but generation speeds goes up linearly based on size. - Type - planets - Only celestial body capable of leveling up with Metal. When upgrading, can choose to focus the upgrade on Range or Launch Velocity. Either choice will still also double Max Ship Capacity, Max Metal Capacity, and Ship Generation speed as well. - quasars - Have 0 Ship Generation or Metal Generation, but _very_ large Ship and Metal capacities. - Cannot be upgraded - spacetime rip - Allows the burning of Metal for points if enabled in game modes. - Generates low number of ships over time, but have no Metal Generation. - Cannot be upgraded - Astroid belts - Astroid belts are the only celestial body that can generate metal. - Cannot be upgraded. - Current Ship Count and Max Ship Capacity - How many ships the planet has. Miniscule planets are always 0. Other planets, when spawned have “Native Population” on them, and start with a static number of ships. Players have to attack them with their ships to wear down the defenses to win the planet. Native Population ships do _not_ regenerate, even if the planet has Ship Generation capacity. - Ship Generation Speed - Only active if the planet is owned by a _player_ - How many ships per game tick does the planet generate. - Metal Count and Metal Capacity - Metal Generation Speed - Range - The distance a packet of ships can go before starting to lose ships. If the range is 3 for example, every 3 distance traveled, 1 ship is lost. 2 ships launched would be able to go up to 6 units max (and only 1 ship would arrive). - Launch Velocity - The speed at which ships travel between two points. The higher this number, the more distance ships can cover to the target planet if launched by this planet. - Comets - Usually _no_ comets, but 15% chance to spawn one coment, and 5% chance to spawn two comets. - Each comet x2 a capacity, metal/ship generation speed, range, or launch velocity stat. Each stat can only be boosted once, if two comets spawn, it’ll modify two different stats.

### **Perlin Noise Map**

Since state of planets is stored on chain, instead of generating all planets straight away, we have some random function, that when given a (x,y) coordinate will hash it and based on some noise function, will determine if it’s dead space or a planet, and if a planet, what level and if it has any comets.

### **Fog of War**

The FoW mechanic works by players hashing (x,y, gameId) coordinates on their machine. If the resulting hash, when passed through the noise function, results in a planet, they know the seed of the PDA on Solana that’s tracking updates for the account. The hash is the seed.

If the account exists, someone has already created the planet account. They can start listening to events that feature that account and then update state for it locally.

If the account doesn’t exist, they can create it straight away, or wait til they want to attack it to create it, or just watch for events if that gets created. If they want to create the account, they call the create planet function (with encrypted x,y coordinates for the Arcium MPC server). This call will create an encrypted key (using the hash(x,y,gameId) as bytes for the input) for that planet. Account updates are stored within a second account, encrypted with this key.

When player discover the (x,y) coordinate of a planet, they know both the hash that’s the seed of the PDA of the account on chain, and the key needed to start decrypting the data from that account locally.

### **Actions**

The following are actions payers can take:

1. Spawn
   - Have to “search” for a suitable planet by hunting for (x, y, gameid) coordinates that hash into a neutral Miniscule Planet (no other type or size of celestial body can be spawned at).
2. Attack
   - Send ships from a planet they own to a target planet. If they own the target planet, ships are added to it’s count. Excess ships are destroyed. If the planet has native population or is owned by enemy player, the target planets ships go _down_ by the amount of attacking ships. If there’s atleast one attacking ship remaining after all defending ships have been defeated, the planet changes owners to the attacker.
3. Broadcast
   - Players can broadcast the (x, y, gameId) coordinates of the planet so all players listening can reveal it in their fog of war.
4. Upgrade Planet
   1. Players can spend increasing amounts of Metal to upgrade planets from lower level to a higher level (see Celestial Bodies ‘Planets’ section for more info).

## **Software Components**

We’re going to setup the project as a monorepo with three components. They will be distributed in a monorepo, with `arcium init` for the on chain program, and `bunx sv create …` for the player client.

### **Solana & Arcium Programs**

Using arcium init we will set up an arcium project. This will contain our on chain program. The solana program will have the following entrypoints (using Arcium with underlying Anchor lang structure): 1. `create-game` 1. Anyone can permissionlessly create a game and become and admin of it. They set the config details and start time and other details as outlined in the admin config section above. 2. `init-player` 1. If whitelist is enabled, requires sever signature, else can be called once by any keypair. 2. Creates a ‘player’ info account with relevant info like player account owner keypair, points, etc. 3. `spawn` 1. Can be called once per game per player account. Checks that the spawning planet is valid per spawn rules of the config, and creates the planet account for the given (x,y) coordinates, setting the given player as the owner. 2. When creating a planet account, it uses the hash of the planet’s coordinates plus the game id (x, y, gameid) as bytes for key generation. This key is used to encrypt all output logs, and users will have to recompute the key locally to decrypt logs from this planet. 4. `move` 1. Metal cannot move by itself, it moves with Ships. Unlike ships, it does NOT decay over distance. As long as one ship makes it to it’s destination, all the metal attached in that shipment makes it to the final destination. 2. When a ‘move’ action is taken between Sending Planet and Target Planet, the initial computation is on if the sending planet has enough resources (ships,metal, etc) then based on sending planet’s range and launch velocity, and _landing time_ is computed for when any ships would get to the target planet and how many of them would survive the journey. This is stored in a stack on an the sending planet’s pending_moves account. 3. Whenever making a ‘move’ action, all pending_moves for a sending planet (those moves that would end before the new action would be taken) are evaluated and applied against the planet before computation for the new move can take place. 1. Since the pending moves could be applied at any time, we need to ensure that ship generation can be computed deterministically given the last time the ships were updated + some algo that takes into account the 5. `upgrade` 1. Players can spend increasing amounts of Metal to upgrade planets from lower level to a higher level (see Celestial Bodies ‘Planets’ section for more info). 6. `broadcast` 1. Players can broadcast the (x, y, gameId) coordinates of the planet as an unencrypted log so all players listening can reveal it in their fog of war. 7. `cleanup-account` 1. If a game has ended, anyone should be able to permissionlessly cleanup accounts for that game to claim back rent

Some key things to consider:

1. Encrypted Events
   1. Events (such as an attack taking place) are broadcast as logs encrypted with the _planet_ encrypted key. This key is derived from hash(x, y, gameId) as bytes32
2. Any given celestial body tracks both a planet account with it’s relevant metadata, and a pending attacks account, which tracks attacks that have been initiated against the planet. Whenever attacking _from_ a planet, the pending attacks must first be “flushed” in order of which attacks would land on the planet in order to resolve current ships and ownership of the planet. This is because the chain must be lazily evaluated (no need for cranking), while the front end can give more optimistic visual data.

### **Typescript SDK + Svelte 5 + ThreeJS Player Client**

This will feature a Typescript Svelte 5 player client that will listen to events from the RPC and store them in indexeddb (using reactive Svelte friendly db library like signaldb.js) and use threejs for game UI. It should also have the ability for players to create and run javascript plugins in service workers in their browser and a Typescript SDK to wrap all the instructions/on chain transaction calls/data fetching/etc. When loading the game, it’ll check for all the planets it has ‘revealed’ and fetch updates for those to build recent game state from their accounts, and subscribe to ongoing log updates that mention any of those accounts. For the UI we’ll use Threejs shaders to make planets with different colors and sizes and a movable UI for ‘windows’ on the game canvas. This UI should be usable by module developers through the SDK so they can have their mods have modular movable UI in the canvas as well.
