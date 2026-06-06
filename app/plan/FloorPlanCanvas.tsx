'use client'

import { useEffect, useState, useRef } from 'react'
import { Stage, Layer, Rect, Text, Group, Line } from 'react-konva'
import type { FurnitureItem } from '@/types'

const DIMS: Record<string, { w: number; d: number }> = {
  'Sofa':         { w: 210, d: 85  },
  'Bed':          { w: 160, d: 200 },
  'Chair':        { w: 65,  d: 65  },
  'Coffee Table': { w: 110, d: 60  },
  'Dining Table': { w: 140, d: 80  },
  'Light':        { w: 35,  d: 35  },
}

const COLORS: Record<string, string> = {
  'Sofa':         '#4F84A6',
  'Bed':          '#7C5C8A',
  'Chair':        '#4CAF7D',
  'Coffee Table': '#C9A84C',
  'Dining Table': '#C9A84C',
  'Light':        '#E8C97A',
}

interface Piece {
  id: string
  name: string
  category: string
  x: number
  y: number
}

interface Props {
  furniture: FurnitureItem[]
  width: number
  length: number
}

const PADDING = 50
const CANVAS_H = 520

export default function FloorPlanCanvas({ furniture, width, length }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(600)
  const [pieces, setPieces] = useState<Piece[]>([])
  const [ready, setReady] = useState(false)

  const roomW = width * 100
  const roomL = length * 100
  const availW = containerWidth - PADDING * 2
  const availH = CANVAS_H - PADDING * 2
  const scale = Math.min(availW / roomW, availH / roomL)
  const drawW = roomW * scale
  const drawH = roomL * scale
  const roomX = PADDING + (availW - drawW) / 2
  const roomY = PADDING + (availH - drawH) / 2

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(entries => {
      setContainerWidth(entries[0].contentRect.width)
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!furniture.length) return
    const placed: Piece[] = furniture.map((item, i) => {
      const dim = DIMS[item.category] ?? { w: 80, d: 80 }
      const fw = dim.w * scale
      const fd = dim.d * scale
      const cols = Math.max(1, Math.floor(drawW / (fw + 10)))
      const col = i % cols
      const row = Math.floor(i / cols)
      return {
        id: item.id,
        name: item.name,
        category: item.category,
        x: roomX + col * (fw + 10) + 5,
        y: roomY + row * (fd + 10) + 5,
      }
    })
    setPieces(placed)
    setReady(true)
  }, [furniture, scale, roomX, roomY, drawW])

  function movePiece(id: string, x: number, y: number) {
    setPieces(prev => prev.map(p => (p.id === id ? { ...p, x, y } : p)))
  }

  return (
    <div className="space-y-4">
      <div
        ref={containerRef}
        className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden"
      >
        {ready && (
          <Stage width={containerWidth} height={CANVAS_H}>
            <Layer>
              <Rect
                x={roomX} y={roomY}
                width={drawW} height={drawH}
                fill="#12121f"
                stroke="#C9A84C"
                strokeWidth={2}
              />

              {Array.from({ length: Math.ceil(width) + 1 }).map((_, i) => (
                <Line key={`v${i}`}
                  points={[roomX + i * scale * 100, roomY, roomX + i * scale * 100, roomY + drawH]}
                  stroke="#1e1e30" strokeWidth={1}
                />
              ))}
              {Array.from({ length: Math.ceil(length) + 1 }).map((_, i) => (
                <Line key={`h${i}`}
                  points={[roomX, roomY + i * scale * 100, roomX + drawW, roomY + i * scale * 100]}
                  stroke="#1e1e30" strokeWidth={1}
                />
              ))}

              <Text x={roomX} y={roomY - 22} text={`${width}m`}
                fill="#8A8480" fontSize={11} />
              <Text x={roomX - 32} y={roomY + drawH / 2}
                text={`${length}m`} fill="#8A8480" fontSize={11}
                rotation={-90} />

              {pieces.map(piece => {
                const item = furniture.find(f => f.id === piece.id)
                if (!item) return null
                const dim = DIMS[piece.category] ?? { w: 80, d: 80 }
                const fw = dim.w * scale
                const fd = dim.d * scale
                const color = COLORS[piece.category] ?? '#5B9BD5'

                return (
                  <Group
                    key={piece.id}
                    x={piece.x} y={piece.y}
                    draggable
                    onDragEnd={e => movePiece(piece.id, e.target.x(), e.target.y())}
                    dragBoundFunc={pos => ({
                      x: Math.max(roomX, Math.min(pos.x, roomX + drawW - fw)),
                      y: Math.max(roomY, Math.min(pos.y, roomY + drawH - fd)),
                    })}
                  >
                    <Rect
                      width={fw} height={fd}
                      fill={color + '33'}
                      stroke={color}
                      strokeWidth={1.5}
                      cornerRadius={3}
                    />
                    <Text
                      text={piece.name}
                      fontSize={Math.max(8, Math.min(11, fw / 9))}
                      fill="white"
                      width={fw} height={fd}
                      align="center" verticalAlign="middle"
                      padding={3}
                      listening={false}
                    />
                  </Group>
                )
              })}
            </Layer>
          </Stage>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {furniture.map(item => {
          const color = COLORS[item.category] ?? '#5B9BD5'
          return (
            <div key={item.id}
              className="flex items-center gap-2 bg-zinc-900 border border-zinc-800
                         rounded-lg px-3 py-1.5">
              <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                style={{ backgroundColor: color }} />
              <span className="text-xs text-zinc-300">{item.name}</span>
              <span className="text-xs text-zinc-600">{item.category}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
