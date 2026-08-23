/** Designer-typical tap points when the user asks the AI to place the piece. */
export function suggestFurniturePlacement(category?: string | null): { x: number; y: number } {
  switch (category) {
    case 'Sofa':
      return { x: 0.5, y: 0.62 }
    case 'Chair':
      return { x: 0.74, y: 0.58 }
    case 'Coffee Table':
      return { x: 0.5, y: 0.72 }
    case 'Dining Table':
      return { x: 0.5, y: 0.66 }
    case 'Side Table':
      return { x: 0.22, y: 0.62 }
    case 'TV Unit':
      return { x: 0.5, y: 0.44 }
    case 'Rug':
      return { x: 0.5, y: 0.8 }
    case 'Bed':
      return { x: 0.5, y: 0.55 }
    case 'Wardrobe':
      return { x: 0.82, y: 0.46 }
    case 'Light':
      return { x: 0.5, y: 0.16 }
    case 'Curtains':
      return { x: 0.5, y: 0.28 }
    default:
      return { x: 0.5, y: 0.56 }
  }
}

export function suggestWallPlacement(): { x: number; y: number } {
  return { x: 0.5, y: 0.32 }
}

export function suggestLightPlacement(kind?: string | null): { x: number; y: number } {
  switch (kind) {
    case 'chandelier':
    case 'pendant':
      return { x: 0.5, y: 0.14 }
    case 'floor':
      return { x: 0.2, y: 0.72 }
    case 'sconce':
      return { x: 0.12, y: 0.4 }
    default:
      return { x: 0.5, y: 0.18 }
  }
}
