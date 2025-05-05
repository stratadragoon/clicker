// server.js
const path           = require('path');
const express        = require('express');
const http           = require('http');
const { Server }     = require('socket.io');
const { MongoClient }= require('mongodb');

const uri = process.env.MONGO_URI;
if (!uri) {
    console.error('❌ missing MONGO_URI');
    process.exit(1);
}

async function start() {
    const client = new MongoClient(uri);
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db     = client.db('myClickerApp');
    const users  = db.collection('users');
    const bosses = db.collection('bosses');

    // Seed bosses with expReward always
    await bosses.updateOne(
        { _id: 'slugZone' },
        {
            $setOnInsert: { name: 'Slug', maxHP: 10, currentHP: 10 },
            $set: { expReward: 2 }
        },
        { upsert: true }
    );
    await bosses.updateOne(
        { _id: 'spiderWeb' },
        {
            $setOnInsert: { name: 'Spider', maxHP: 50, currentHP: 50 },
            $set: { expReward: 12 }
        },
        { upsert: true }
    );

    const app = express();
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));
    app.get('/', (req, res) =>
        res.sendFile(path.join(__dirname, 'public', 'index.html'))
    );

    // Create or fetch a user
    app.get('/api/users/:userId', async (req, res) => {
        const { userId } = req.params;
        let user = await users.findOne({ _id: userId });
        if (!user) {
            user = {
                _id: userId,
                currentZone: 'slugZone',
                unlockedZones: ['slugZone'],
                unlockedWeapons: ['woodenSword'],
                weapons: {
                    woodenSword: { level: 1, xp: 0 },
                    stoneSword:  { level: 0, xp: 0 }
                }
            };
            await users.insertOne(user);
        }
        res.json(user);
    });

    // Change current zone
    app.post('/api/users/:userId/zone/:zone', async (req, res) => {
        const { userId, zone } = req.params;
        await users.updateOne(
            { _id: userId },
            { $set: { currentZone: zone } }
        );
        res.sendStatus(200);
    });

    const server = http.createServer(app);
    const io     = new Server(server);

    // Weapon exp thresholds
    const wepConfig = {
        woodenSword: { exp: [0,20,100,800,4000] },
        stoneSword:  { exp: [0,40,200,1600,8000] }
    };

    io.on('connection', socket => {
        console.log(`🟢 ${socket.id} connected`);

        socket.on('joinZone', async ({ userId, zone }) => {
            socket.data.userId = userId;
            socket.data.zone   = zone;
            const user = await users.findOne({ _id: userId });
            if (!user || !user.unlockedZones.includes(zone)) return;
            socket.join(zone);

            const boss = await bosses.findOne({ _id: zone });
            socket.emit('boss state', boss);
            socket.emit('user state', user);
        });

        socket.on('hit', async ({ userId, zone, damage }) => {
            const dmg = parseInt(damage, 10);
            if (isNaN(dmg) || dmg < 1) return;

            // 1) Decrement boss HP
            await bosses.updateOne(
                { _id: zone, currentHP: { $gt: 0 } },
                { $inc: { currentHP: -dmg } }
            );
            let boss = await bosses.findOne({ _id: zone });

            // 2) Award damage XP
            const user = await users.findOne({ _id: userId });
            const aw   = user.unlockedWeapons[0];
            user.weapons[aw].xp += dmg;
            await users.updateOne(
                { _id: userId },
                { $set: { weapons: user.weapons }}
            );

            // 3) Check for boss kill
            let killed = false;
            if (boss.currentHP <= 0) {
                killed = true;
                boss.currentHP = boss.maxHP;
                await bosses.updateOne(
                    { _id: zone },
                    { $set: { currentHP: boss.maxHP } }
                );
            }

            // 4) Award kill XP if killed
            if (killed) {
                const reward = boss.expReward || 0;
                const room = io.sockets.adapter.rooms.get(zone) || new Set();
                for (const sid of room) {
                    const sock = io.sockets.sockets.get(sid);
                    const uid  = sock.data.userId;
                    if (!uid) continue;

                    const p = await users.findOne({ _id: uid });
                    const w = p.unlockedWeapons[0];
                    p.weapons[w].xp += reward;
                    // level-up
                    while (
                        p.weapons[w].level < wepConfig[w].exp.length &&
                        p.weapons[w].xp   >= wepConfig[w].exp[p.weapons[w].level]
                    ) {
                        p.weapons[w].xp -= wepConfig[w].exp[p.weapons[w].level];
                        p.weapons[w].level++;
                    }
					// 1) When woodenSword hits Lv3, add stoneSword:
					if (w === 'woodenSword'
						&& p.weapons.woodenSword.level >= 3
						&& !p.unlockedWeapons.includes('stoneSword')
					) {
						p.unlockedWeapons.push('stoneSword');
					}

					// 2) Whenever stoneSword is in unlockedWeapons, add spiderWeb zone:
					if (p.unlockedWeapons.includes('stoneSword')
						&& !p.unlockedZones.includes('spiderWeb')
					) {
						p.unlockedZones.push('spiderWeb');
					}

					await users.updateOne(
						{ _id: uid },
						{ $set: { weapons: p.weapons }}
					);
					// Persist weapons + any newly-unlocked weapons or zones:
					await users.updateOne(
						{ _id: uid },
						{
							$set: {
								weapons:          p.weapons,
								unlockedWeapons:  p.unlockedWeapons,
								unlockedZones:    p.unlockedZones
							}
						}
					);
					sock.emit('user state', p);
                }
            }

            // 5) Emit updated states
            const updatedUser = await users.findOne({ _id: userId });
            socket.emit('user state', updatedUser);
            io.to(zone).emit('boss state', boss);
        });

        socket.on('disconnect', () => console.log(`🔴 ${socket.id} disconnected`));
    });

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => console.log(`🚀 Listening on ${PORT}`));
}

start().catch(err => {
    console.error('Startup error:', err);
    process.exit(1);
});
