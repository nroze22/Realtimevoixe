/**
 * A curated list of audio interfaces / mixers common in churches, with
 * concrete wiring guidance for each. Surfaced in the operator pre-flight
 * wizard as a disclosure that helps a volunteer figure out which device to
 * pick and how to physically wire it up.
 */

export interface EquipmentProfile {
  id: string;
  category: 'digital-mixer' | 'usb-interface' | 'computer';
  name: string;
  /** Short user-facing one-liner. */
  blurb: string;
  /** Step-by-step wiring guidance. */
  steps: string[];
  /** Hint for picking the right input in the device dropdown. */
  deviceHint?: string;
}

export const EQUIPMENT_PROFILES: EquipmentProfile[] = [
  {
    id: 'x32-m32',
    category: 'digital-mixer',
    name: 'Behringer X32 / Midas M32 (USB)',
    blurb: 'Most common church mixer. Use the on-board 32-ch USB interface.',
    steps: [
      'On the X32: route a clean post-EQ mono aux send to a card output channel (e.g., Card 31/32).',
      'Connect the X32 USB-B port to this laptop with a USB-A cable.',
      'Pick "X-USB" / "X32 USB Audio" in the device dropdown above.',
      'Channel mapping: the routed card channel becomes input 31 or 32 on the laptop.',
    ],
    deviceHint: 'X-USB · X32 USB Audio',
  },
  {
    id: 'yamaha-ql-cl',
    category: 'digital-mixer',
    name: 'Yamaha QL / CL / TF (Dante or USB)',
    blurb: 'Use Dante Virtual Soundcard or the front-panel USB.',
    steps: [
      'Route a post-EQ mono aux/matrix mix to either a Dante channel or the front-panel USB stereo out.',
      'Install Dante Virtual Soundcard on this laptop (for Dante path) or use a class-compliant USB cable.',
      'Pick "Dante Virtual Soundcard" or "Yamaha USB Audio" in the device dropdown.',
      'In DVS, subscribe one channel of the laptop interface to the QL/CL Dante source.',
    ],
    deviceHint: 'Dante Virtual Soundcard · Yamaha USB',
  },
  {
    id: 'allen-heath-sq',
    category: 'digital-mixer',
    name: 'Allen & Heath SQ / Avantis',
    blurb: 'Use the on-board USB-B audio or SLink + Dante card.',
    steps: [
      'Assign a mono aux to a USB output channel via the SQ-Drive routing screen.',
      'Connect the rear USB-B port to this laptop.',
      'Pick "SQ USB Audio" in the device dropdown.',
      'Channels 1–32 mirror the USB output routing — confirm which channel you used.',
    ],
    deviceHint: 'SQ USB Audio',
  },
  {
    id: 'presonus-studiolive',
    category: 'digital-mixer',
    name: 'PreSonus StudioLive Series III',
    blurb: 'Native AVB + class-compliant USB.',
    steps: [
      'Assign a mono aux bus to a USB return slot in Universal Control.',
      'Connect the console USB-B to the laptop and pick "StudioLive III USB".',
    ],
    deviceHint: 'StudioLive III USB',
  },
  {
    id: 'usb-interface',
    category: 'usb-interface',
    name: 'External USB interface (Focusrite Scarlett, MOTU, etc.)',
    blurb: 'For analog/digital mixers without USB output.',
    steps: [
      'Take a balanced TRS or XLR from any post-EQ mono aux send on the mixer.',
      'Plug into input 1 of the USB interface (line level, not mic).',
      'Make sure phantom power is OFF for that input.',
      'Connect the interface to this laptop and pick it in the device dropdown.',
    ],
    deviceHint: 'Focusrite · Scarlett · MOTU · UMC22 · etc.',
  },
  {
    id: 'system-audio',
    category: 'computer',
    name: 'System audio / app share',
    blurb: 'No external hardware — share an app or system audio.',
    steps: [
      'Install Loopback (macOS), VB-CABLE (Windows), or use a virtual audio device.',
      'Route the source app (ProPresenter, OBS, Zoom, etc.) to the virtual device.',
      'Pick the virtual device in the dropdown above.',
    ],
    deviceHint: 'Loopback · VB-CABLE · BlackHole',
  },
];
