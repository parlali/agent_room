import { createServer } from 'node:net'

export class LoopbackPortAllocator {
    private readonly reservedPorts = new Set<number>()

    async allocate(): Promise<number> {
        const port = await this.findOpenPort()
        if (this.reservedPorts.has(port)) {
            throw new Error(`Allocated duplicate port ${port}`)
        }
        this.reservedPorts.add(port)
        return port
    }

    release(port: number | null) {
        if (port === null) {
            return
        }
        this.reservedPorts.delete(port)
    }

    reserve(port: number) {
        if (this.reservedPorts.has(port)) {
            throw new Error(`Port ${port} is already reserved`)
        }
        this.reservedPorts.add(port)
    }

    isReserved(port: number) {
        return this.reservedPorts.has(port)
    }

    private async findOpenPort(): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            const server = createServer()
            server.on('error', (error) => {
                reject(error)
            })
            server.listen(
                {
                    host: '127.0.0.1',
                    port: 0,
                    exclusive: true,
                },
                () => {
                    const address = server.address()
                    if (!address || typeof address === 'string') {
                        server.close()
                        reject(new Error('Failed to allocate loopback port'))
                        return
                    }
                    const { port } = address
                    server.close((closeError) => {
                        if (closeError) {
                            reject(closeError)
                            return
                        }
                        resolve(port)
                    })
                },
            )
        })
    }
}

export const loopbackPortAllocator = new LoopbackPortAllocator()
