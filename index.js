const Discord = require('discord.js');

// const
// {
// 	prefix,
// 	token,
// } = require('./config.json');

const prefix = '~';

const ytdl = require('ytdl-core');
const yts = require("yt-search");
const ytpl = require('ytpl');

/// Some global objects
const { MessageEmbed } = require('discord.js');
const EMOTE_CONFIRM = '👌';
const EMOTE_ALREADY_DONE = '♻️';
const EMOTE_PREV = '⬅️';
const EMOTE_NEXT = '➡️';
const EMOTE_ERROR = '🛑';

/// Queue ///
const queueMap = new Map();

/// Some global settings
const numSongsPerQueuePage = 10;

//////////////////////////////////////////////////////////////////////////////
/// ---------------------------------------------------------------------- ///
//////////////////////////////////////////////////////////////////////////////
/// Login ///
const client = new Discord.Client();
client.login(process.env.DJS_TOKEN);

client.on('ready', () =>
{
	console.log('Ready!');
});
client.on('reconnecting', () =>
{
	console.log('Reconnecting!');
});
client.on('disconnect', () =>
{
	console.log('Disconnect!');
});

/// Listener ///
client.on('message', async message =>
{
	if (message.author.bot)
	{
		return;
	} 
	
	if (!message.content.startsWith(prefix))
	{
		return;
	} 

	// guild = server. We're assuming each server has only one instance of this bot
	const serverQueue = queueMap.get(message.guild.id);

	const args = message.content.split(" ");
	const contentToPlay = args.slice(1).join(" ");

	if (args[0] == `${prefix}play` || args[0] == `${prefix}p`)
	{
		queueSong(message, serverQueue);
		return;
	}
	if (args[0] == `${prefix}pause`)
	{
		pause(message, serverQueue);
		return;
	}
	if (args[0] == `${prefix}resume`)
	{
		resume(message, serverQueue);
		return;
	}
	else if (args[0] == `${prefix}next` || args[0] == `${prefix}n`)
	{
		next(message, serverQueue);
		return;
	}
	else if (args[0] == `${prefix}clear` || args[0] == `${prefix}stop`)
	{
		clear(message, serverQueue);
		return;
	}
	else if (args[0] == `${prefix}queue`)
	{
		getQueue(message, serverQueue);
		return;
	}
	else if (args[0] == `${prefix}shuffle`)
	{
		shuffle(message, serverQueue);
		return;
	}
	else if (args[0] == `${prefix}loop`)
	{
		loop(message, serverQueue);
		return;
	}
	else if (args[0] == `${prefix}leave`)
	{
		leave(message, serverQueue);
		return;
	}
	else
	{
		let embed = new MessageEmbed()
			.setTitle(`Command not found, please refer to ${prefix}help for more information.`);
		return message.channel.send(embed);
	}
})

client.on('messageReactionAdd', (reaction, user) =>
{
	let message = reaction.message;
	let emoji = reaction.emoji;

	if (!message.author.bot) // Only handle reactions on our messages
	{
		return;
	}
	
	if (reaction.me) // Disregard our own reactions
	{
		return;
	}

	if (message.embeds.length === 0) // Assume all our messages are embedded
	{
		return;
	}
	
	const embed = message.embeds[0];
	const serverQueue = queueMap.get(message.guild.id);

	// Queue page turning
	if (embed.title.includes(`Current queue`))
	{
		let pageCounters = embed.footer.text.split("/");
		let currentPage = parseInt(pageCounters[0]) - 1;
		let numPages = parseInt(pageCounters[1]);

		if (emoji.name === EMOTE_PREV)
		{
			--currentPage;
			if (currentPage < 0)
			{
				currentPage = numPages - 1;
			}

			switchQueuePage(message, serverQueue, currentPage);
		}
		else if (emoji.name === EMOTE_NEXT)
		{
			++currentPage;
			if (currentPage > numPages - 1)
			{
				currentPage = 0;
			}

			switchQueuePage(message, serverQueue, currentPage);
		}
	}
});

// TODO: do we need to handle disconnect/rejoin?

//////////////////////////////////////////////////////////////////////////////
/// ---------------------------------------------------------------------- ///
//////////////////////////////////////////////////////////////////////////////
/// Commands ///
async function queueSong(message, serverQueue)
{
	const args = message.content.split(" ");
	const contentToPlay = args.slice(1).join(" ");

	// Error checking
	if (!channelQueueCheck(message, serverQueue, false, false))
	{
		return;
	}
	
	const voiceChannel = message.member.voice.channel;

	const permissions = voiceChannel.permissionsFor(message.client.user);
	if (!permissions.has("CONNECT") || !permissions.has("SPEAK"))
	{
		let embed = new MessageEmbed()
			.setTitle("Lord please granteth me the permission to joineth and speaketh in thy holy voice channels.");
		return message.channel.send(embed);
	}

	// Resolve the requested content into a list of songs to add
	let songs = await getSongsInfo(message, contentToPlay);

	if (songs.length === 0)
	{
		return;
	}

	// Set the requester
	for (let song of songs)
	{
		song.addedBy = message.author.id;
	}

	// If the queue doesn't exist yet, start a new one
	if (!serverQueue)
	{
		// Creating the a new queue for our queueMap
		const newQueue =
		{
			textChannel: message.channel,
			voiceChannel: voiceChannel,
			connection: null,
			songs: [],
			volume: 5,
			playing: -1,
			looping: false,
		};

		// Add to queueMap
		queueMap.set(message.guild.id, newQueue);

		serverQueue = newQueue;
		
		// Join the voicechat
		try
		{
			newQueue.connection = await voiceChannel.join();
		}
		catch (error)
		{
			queueMap.delete(message.guild.id);
			newQueue.connection.delete();

			let embed = new MessageEmbed()
				.setTitle("Unexpected error joining voice chat.")
				.setDescription("Error: " + error)
				.setFooter("Please try again or bonk Frosty");
			return message.channel.send(embed);
		}
	}

	// Add the songs
	const indexAdded = serverQueue.songs.length; // the added songs start from this index
	serverQueue.songs.push.apply(serverQueue.songs, songs);

	// UI messages
	if (songs.length === 1)
	{
		if (!isQueuePlaying(serverQueue)) // don't send queued message because we're gonna play this song right away
		{
			let embed = new MessageEmbed()
				.setTitle(`Queued ${songs[0].title}.`);
			message.channel.send(embed);
		}
	}
	else
	{
		let embed = new MessageEmbed()
			.setTitle(`Queued ${songs.length} songs`);
		message.channel.send(embed);
	}

	// If we are not playing anything, play the first added song
	if (!isQueuePlaying(serverQueue))
	{
		playSong(serverQueue, indexAdded);
	}
}

async function getSongsInfo(message, contentToPlay)
{
	let songs = [];

	// Youtube - Single vid
	if (ytdl.validateURL(contentToPlay))
	{
		console.log("Found single vid url");
		try
		{
			songInfo = await ytdl.getInfo(contentToPlay);
		}
		catch (error)
		{
			let embed = new MessageEmbed()
				.setTitle("Invalid video link")
				.setDescription(error);
			message.channel.send(embed);
			return songs;
		}
		
		console.log(songInfo);
		const song =
		{
			title: songInfo.videoDetails.title,
			url: songInfo.videoDetails.video_url,
		};
		songs.push(song);

		return songs;
	}
	
	// Youtube - Playlist
	if (ytpl.validateID(contentToPlay))
	{
		const playistID = await ytpl.getPlaylistID(contentToPlay);
		var playlist;
		try
		{
			playlist = await ytpl(playistID, { limit : Infinity });
		}
		catch (error)
		{
			let embed = new MessageEmbed()
				.setTitle("Invalid playlist link")
				.setDescription(error);
			message.channel.send(embed);
			return songs;
		}

		for(let songInfo of playlist.items)
		{
			const song =
			{
				title: songInfo.title,
				url: songInfo.shortUrl,
			};
			songs.push(song);
		}

		return songs;
	}

	// Title search
	console.log("Searching for video by title");

	// Get song from title
	const {videos} = await yts(contentToPlay);
	if (!videos.length)
	{
		let embed = new MessageEmbed()
			.setTitle("No songs found.");
		message.channel.send(embed);
		return songs;
	}

	const song =
	{
		title: videos[0].title,
		url: videos[0].url,
	};

	songs.push(song);
	return songs;
}

function playSong(serverQueue, index)
{
	serverQueue.playing = index;
	if (serverQueue.playing < 0 || serverQueue.playing >= serverQueue.songs.length)
	{
		let embed = new MessageEmbed()
			.setTitle(`Error playing song: song index in queue oob.`);
		return serverQueue.textChannel.send(embed);
	}
	
	const song = serverQueue.songs[serverQueue.playing];

	if (!song)
	{
		// Shouldn't get here but just in case
		let embed = new MessageEmbed()
			.setTitle(`Error playing song. Skipping to next...`);
		serverQueue.textChannel.send(embed);

		playNextSong(serverQueue);

		return;
	}

	let embed = new MessageEmbed()
		.setTitle("Now playing")
		.setDescription(`**[${song.title}](${song.url})** [<@${song.addedBy}>]`);
	serverQueue.textChannel.send(embed);

	// Play the song on our set connection
	// dispatcher is like a handle returned by .play(), and is set automatically on the connection by calling this function.
	const dispatcher = serverQueue.connection
		.play(ytdl(song.url))
		.on("finish", () =>
		{
			playNextSong(serverQueue);
		})
		.on("error", error => 
		{
			const errorStr = "Error encountered while playing video: " + error.toString().replace('Error: input stream: ', '');
			let embed = new MessageEmbed()
				.setTitle(errorStr);
			serverQueue.textChannel.send(embed);

			playNextSong(serverQueue);
		});

	dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);
}

function playNextSong(serverQueue)
{
	let nextSongIndex = serverQueue.playing + 1;
	if (nextSongIndex >= serverQueue.songs.length)
	{
		if (serverQueue.looping)
		{
			nextSongIndex = 0;
		}
		else
		{
			let embed = new MessageEmbed()
				.setTitle(`Reach the end of queue.`);
			return serverQueue.textChannel.send(embed);
		}
	}

	playSong(serverQueue, nextSongIndex);
}

function pause(message, serverQueue)
{
	if (!channelQueueCheck(message, serverQueue, true))
	{
		return;
	}

	if (!serverQueue.connection.dispatcher.paused)
	{
		serverQueue.connection.dispatcher.pause(true);
		message.react(EMOTE_CONFIRM);
	}
	else
	{
		message.react(EMOTE_ALREADY_DONE);
	}

}

function resume(message, serverQueue)
{
	if (!channelQueueCheck(message, serverQueue, true))
	{
		return;
	}

	if (serverQueue.connection.dispatcher)
	{
		if (serverQueue.connection.dispatcher.paused)
		{
			serverQueue.connection.dispatcher.resume();
			message.react(EMOTE_CONFIRM);
		}
		else
		{
			message.react(EMOTE_ALREADY_DONE);
		}

		return;
	}

	message.react(EMOTE_ERROR);
}

function next(message, serverQueue)
{
	if (!channelQueueCheck(message, serverQueue, true))
	{
		return;
	}

	serverQueue.connection.dispatcher.end();
	message.react(EMOTE_CONFIRM);
}

function clear(message, serverQueue)
{
	if (!channelQueueCheck(message, serverQueue))
	{
		return;
	}

	serverQueue.songs = [];

	if (serverQueue.connection.dispatcher)
	{
		serverQueue.connection.dispatcher.end();
	}
	
	message.react(EMOTE_CONFIRM);
}

function getQueue(message, serverQueue)
{
	if (!channelQueueCheck(message, serverQueue))
	{
		return;
	}

	const numSongs = serverQueue.songs.length;
	if (numSongs === 0)
	{
		let embed = new MessageEmbed()
			.setTitle("The queue is currently empty.");
		return message.channel.send(embed);
	}

	// Display the page with currently played song
	const currentPage = Math.floor(serverQueue.playing / numSongsPerQueuePage);
	const queuedSongs = parseQueue(serverQueue, currentPage);
	if (queuedSongs === "")
	{
		return;
	}

	const numPages = Math.ceil(serverQueue.songs.length / numSongsPerQueuePage);

	let embed = new MessageEmbed()
		.setTitle(`Current queue for #${message.channel.name}`)
		.setDescription(queuedSongs)
		.setFooter(`${currentPage + 1}/${numPages}`);
	message.channel.send(embed)
		.then(sent => 
		{
			if (numPages === 1)
			{
				// Only 1 page of queue, we're done here.
				return;
			}
			
			// Add reactions to go to next/prev pages
			sent.react(EMOTE_PREV).then(() => sent.react(EMOTE_NEXT));
		});
}

function switchQueuePage(message, serverQueue, pageIndex)
{
	const queuedSongs = parseQueue(serverQueue, pageIndex);
	if (queuedSongs === "")
	{
		return;
	}

	const numPages = Math.ceil(serverQueue.songs.length / numSongsPerQueuePage);
	let embed = new MessageEmbed()
		.setTitle(`Current queue for #${message.channel.name}`)
		.setDescription(queuedSongs)
		.setFooter(`${pageIndex + 1}/${numPages}`);

	message.edit(embed);
}

function shuffle(message, serverQueue)
{
	if (!channelQueueCheck(message, serverQueue))
	{
		return;
	}

	for (let i = serverQueue.songs.length - 1; i > 0; i--)
	{
		if (i == serverQueue.playing)
		{
			// Don't shuffle the current song
			continue;
		}

        const j = Math.floor(Math.random() * (i + 1));
        [serverQueue.songs[i], serverQueue.songs[j]] = [serverQueue.songs[j], serverQueue.songs[i]];
    }

	message.react(EMOTE_CONFIRM);
}

function loop(message, serverQueue)
{
	if (!channelQueueCheck(message, serverQueue))
	{
		return;
	}

	serverQueue.looping = !serverQueue.looping;

	let embed = new MessageEmbed()
		.setTitle("Looping for this queue is now " + (serverQueue.looping ? "**enabled**" : "**disabled**"));
	message.channel.send(embed);
}

async function leave(message, serverQueue)
{
	if (!message.guild.me.voice.channel)
	{
		let embed = new MessageEmbed()
			.setTitle(`I am not currently in a voice channel.`);
		return message.channel.send(embed);;
	}

	await message.guild.me.voice.channel.leave();
	message.react(EMOTE_CONFIRM);
}

/// Helper functions /// 
function channelQueueCheck(message, serverQueue, dispatcherCheck = false, connectionCheck = true)
{
	if (!message.member.voice.channel)
	{
		let embed = new MessageEmbed()
			.setTitle(`You need to be in a voice channel to use this command.`);
		message.channel.send(embed);
		return false;
	}
	
	if (message.guild.me.voice.channel && message.guild.me.voice.channel != message.member.voice.channel)
	{
		let embed = new MessageEmbed()
			.setTitle(`This bot is currently being used in another channel.`);
		message.channel.send(embed);
		return false;
	}

	if (connectionCheck && !serverQueue)
	{
		let embed = new MessageEmbed()
			.setTitle(`No song has been queued.`);
		message.channel.send(embed);
		return false;
	}

	if (dispatcherCheck && !serverQueue.connection.dispatcher)
	{
		let embed = new MessageEmbed()
			.setTitle(`No song is currently playing.`);
		message.channel.send(embed);
		return false;
	}

	return true;
}

function parseQueue(serverQueue, pageIndex)
{
	const numSongs = serverQueue.songs.length;
	const numPages = Math.ceil(numSongs / numSongsPerQueuePage);

	if (pageIndex < 0 || pageIndex >= numPages)
	{
		let embed = new MessageEmbed()
			.setTitle(`Error displaying queue: page index oob`);
		message.channel.send(embed);
		return "";
	}

	let queuedSongs = "";
	
	const startIndex = pageIndex * numSongsPerQueuePage;
	const endIndex = Math.min(startIndex + numSongsPerQueuePage - 1, numSongs - 1);

	for (let songIndex = startIndex; songIndex <= endIndex; ++songIndex)
	{
		const song = serverQueue.songs[songIndex];
		const bIsCurrentSong = (songIndex === serverQueue.playing) && isQueuePlaying(serverQueue);

		if (bIsCurrentSong)
		{
			queuedSongs += "**";
		}

		queuedSongs += (songIndex + 1).toString() + ". " + song.title + "\n";

		if (bIsCurrentSong)
		{
			queuedSongs += "**";
		}
	}

	return queuedSongs;
}

function isQueuePlaying(serverQueue)
{
	return serverQueue.connection.dispatcher != null;
}

function cleanUpServerState(serverQueue)
{
	serverQueue.songs = [];

	if (serverQueue.connection.dispatcher)
	{
		serverQueue.connection.dispatcher.end();
	}

	queueMap.delete(message.guild.id);
}

// TODO: More testing to check if stuff that cant be played (member content/private vids, etc.) breaks anything
// TODO: Personal playlists, investigate DB usage probably