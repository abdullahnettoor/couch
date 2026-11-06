// The COUCH wordmark's letters, in em units: cap height 100, baseline y = 0, the U centred on x = 0.
// C, C and H are paths; U and O are rounded polygons [x, y, radius] in the logo's corner order (src/brand/logo.ts),
// so they can morph into the logo. Edit them by hand, or replace them from an SVG (see README, "The wordmark").
import type { Poly } from "./logo.ts";

/** The wordmark's ink, left to right (em). */
export const LEFT = -395.75;
export const WIDTH = 785.13;

export const C1 = "M-251.87 -100L-251.87 -69.25L-353.12 -69.25Q-358.75 -69.25 -358.75 -64.37L-358.75 -35.75Q-358.75 -30.75 -353.12 -30.75L-251.5 -30.75L-251.5 0L-365.62 0Q-395.75 0 -395.75 -24.5L-395.75 -75.62Q-395.75 -100 -365.62 -100Z";
export const C2 = "M230.38 -100L230.38 -69.25L129.13 -69.25Q123.5 -69.25 123.5 -64.37L123.5 -35.75Q123.5 -30.75 129.13 -30.75L230.75 -30.75L230.75 0L116.63 0Q86.5 0 86.5 -24.5L86.5 -75.62Q86.5 -100 116.63 -100Z";
export const H = "M389.38 -100L389.38 0L352.5 0L352.5 -37.12L280.13 -37.12L280.13 0L243.25 0L243.25 -100L280.13 -100L280.13 -68L352.5 -68L352.5 -100Z";
/** The O, outside and inside (the inside becomes the Screen). */
export const O: Poly[] = [[[-239,-100,34.75],[-86.5,-100,34.75],[-86.5,0,34.69],[-239,0,34.69]],[[-202,-30.75,10.81],[-123.5,-30.75,10.81],[-123.5,-69.25,10.88],[-202,-69.25,10.88]]];
/** The U, with the sofa's eight corners. */
export const U: Poly = [[-74,-100,0],[-37.12,-100,0],[-37.12,-30.75,4.75],[37,-30.75,4.56],[37,-100,0],[74,-100,0],[74,0,27.19],[-74,0,27.31]];
