# Self-Driving Car – NN in action

Train a small neural network to drive, three different ways, and watch every weight change, live in your browser.

**▶ Live demo: [hasin.eu/projects/nn-self-driving-car-in-action](https://hasin.eu/projects/nn-self-driving-car-in-action/)**. Works on desktop and phone.

<p>
  <img src="docs/screenshot.png" alt="The road with the blue car and a parked car ahead; below it, the network: two radar inputs, three hidden neurons and the Move! output" width="64%">
  <img src="docs/phone.png" alt="The same on a phone: the road on top, the network below" width="32%">
</p>

## Why I built it

Built for teaching my kids and anyone curious about how machines learn.

Explore various learning methods (flashcards, copycat, trial & error), observe how individual neurons impact a decision and how error correction propagates backwards. Finally, see how the trained network "self-drives".

## What you see

- **The road.** Two lanes with parked cars. The blue car avoids them by changing lane with **Move!**. You can drive it yourself, or switch on the autopilot and let the network drive.
- **The network.** Two inputs from a radar (how close the nearest parked car is in my lane and in the other lane) → three hidden neurons → the output. Every weight and bias is on screen.
- **Weights / Impact.** Weights shows the weights themselves; Impact shows what each connection contributes right now. Green pushes the next neuron up, magenta pushes it down, thicker means stronger.
- **The tour.** A guided walk from the road to an untrained network that drives into a parked car, through training, to the test: 500 m of road it has never seen.

## Three ways to learn

| Method | What it is | How it works here |
| --- | --- | --- |
| **Flashcards** | Supervised learning | You label 8 road situations with the right move. The network trains on 4 and is checked on the other 4, in epochs, with backpropagation. |
| **Copycat** | Imitation learning (behavioural cloning) | You drive 200 m; each of your moves becomes a labelled example, learned straight away. A collision is learned as the opposite move. |
| **Trial & Error** | Reinforcement learning (Deep Q-learning) | Nobody gives it an answer. It practises alone and learns from points and penalties: −20 for a collision, −1.2 for a lane change, more for a late one. |

Each method starts from an untrained network and ends with the same test road. Below the demo, an explainer covers each method in plain language.

The digit demo shows the other side of the story: a trained network recognising handwriting, layer by layer. [Visual Digit Recognition – CNN in action](https://github.com/ehasin/Visual-Digit-Recognition-CNN-in-action).

## Run it locally

There is no build step and no dependencies, only static files. You need [Node.js](https://nodejs.org/) for the bundled server.

```
git clone https://github.com/ehasin/Self-Driving-Car-NN-in-action.git
cd Self-Driving-Car-NN-in-action
node serve.mjs
```

Then open http://localhost:5317 (if that port is taken, the server picks the next free one and prints it). Any other static file server works too, for example `python -m http.server`.

## How it's built

| File | Role |
| --- | --- |
| `index.html` | Page, shared styles and the explainer |
| `app.js` | The page: the road and Move!, the network drawing, the cards, the training board, the autopilot |
| `onboard.js` | The guided tour: its steps and bubbles, the methods window |
| `game.js` | The road: lanes, parked cars, collisions, points and penalties |
| `net.js` | The network: forward pass and backpropagation in plain JavaScript |
| `flash.js` | Flashcards: the cards, training and validation, epochs, the test road |
| `learner.js` | Copycat and Trial & Error (Deep Q-learning with a replay memory) |
| `render.js` | The 3D road view on a canvas |
| `random.js` | Seeded random numbers, so a road can be replayed |
| `share.js` | The share bar (under the methods and the explainer) and the footer's Share, as plain links |
| `site.css`, `desktop.css`, `mobile.css` | Shared look, then desktop and phone layouts |
| `docs/` | Screenshots for this README |
| `serve.mjs` | Tiny local static server |

`game.js`, `net.js`, `flash.js` and `learner.js` have no DOM code, so they also run in Node.

## License

MIT, see [LICENSE](LICENSE).

Built by Evgeni Hasin.
