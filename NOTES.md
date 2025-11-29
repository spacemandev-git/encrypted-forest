# Encrypted Forest

Encrypted Forest is a game on the Solana blockchain that makes use of Arcium MPC network to provide gameplay featuring hidden information.

After admin has created a game with configured settings, players are able to spawn into a low level planet, explore the on chain fog of war, and attack other planets. This basic gameplay can be expanded on with various winning conditions like race for the center or king of the hill or other later stage mechanics.

The core implementation will feature three main components, the on chain programs interfacing with Arcium and Solana, the Svelte 5 based browser client with threejs for the game itself (and the ability to make transactions directly to the chain), and then a backend server based on chain indexer that listens to events from the chain, stores them in a DB and is able to provide streaming and batch updates to connected clients.

## Gameplay

The game centers around an admin configuring the size of a deployed map, then players being able to spawn into a given map by "searching" for a coordinate of a planet that fits spawn criteria. This is a compute intensive process, and the way they search for planets throughout the map. After they spawn, the planet they own generates "ships" continously until it hits some cap. They can send these "ships" to attack other planets, either neutral or owned by other players. If they reduce a rival planet's "ships" to 0, they can claim it and once claimed it starts generating "ships" for them. Neutral planets usually have static number of ships spawned on them per their level, and enemy player planets usually have dynamic "ships" as they continously generate more.

### Admin Config

The admin configures the size of the map (starting at 0,0 and going in all four directions until it hits the configured diameter).
They also set the start and end time of the map. The player with the most planets at the end wins the game.

### Perlin Noise Map

Since state of planets is stored on chain, instead of generating all planets straight away, we have some random function, that when given a (x,y) coordinate will hash it and based on some noise function, will determine if it's dead space or a planet, and if a planet, what level.

### Fog of War

The FoW mechanic works by players hashing (x,y) coordinates on their machine. If the resulting hash, when passed through the noise function, results in a planet, they know the seed of the PDA on Solana that's tracking updates for the account.

If the account exists, someone has already created the planet account. They can start listening to events that feature that account and then update state for it locally.

If the account doesn't exist, they can create it straight away, or wait til they want to attack it to create it, or just watch for events if that gets created. If they want to create the account, they call the create planet function (with encrypted x,y coordinates for the Arcium MPC server). This call will create an encrypted key for that planet and store it encrypted in the planet's account. Account updates are stored within a second account, encrypted with this generated key.

When player discover the (x,y) coordinate of a planet, they can call a function to return the planet key sealed to the player's key, and then use that to decrypt events for that planet client side as they listen to them.

### Player Actions

Players can spawn into the map, attack from a planet to another planet, or fetch the account for a planet (given they have x,y coordinates) and listen to events happening in the game and decrypt them client side.

## Software Components

We're going to setup the project as a monorepo with three components.

### Solana & Arcium Programs

Using arcium init we'll set up an arcium project. This will contain our on chain programs.

### Svelte 5 + ThreeJS Player Client

This will feature a Svelte 5 player client that will lisen to events from the server and store them in indexeddb and use threejs for game UI.

### Backend Indexer

We'll use Bun (including native websockets) to listen to on chain events and then store them and broadcast them to connected clients. Clients will be able to "catch up" by providing a slot number and getting all events since that slot packaged and sent to them (filtered by (x,y) coordinates they provide that they care about).
