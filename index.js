const Discord = require('discord.js');

const
{
	prefix,
	token,
} = require('./config.json');

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
client.login(token);

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
	else if (args[0] == `${prefix}leave`)
	{
		leave(message, serverQueue);
		return;
	}
	else
	{
		var embed = new MessageEmbed()
			.setTitle(`Command not found, please refer to ${prefix}help for more information.`);
		return message.channel.send(embed);
	}
})

client.on('messageReactionAdd', (reaction, user) =>
{
	var message = reaction.message;
	var emoji = reaction.emoji;

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
		var pageCounters = embed.footer.text.split("/");
		var currentPage = parseInt(pageCounters[0]) - 1;
		var numPages = parseInt(pageCounters[1]);

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
	const voiceChannel = message.member.voice.channel;
	if (!voiceChannel)
	{
		var embed = new MessageEmbed()
			.setTitle("You need to be in a voice channel to use this command.");
		return message.channel.send(embed);
	}

	const permissions = voiceChannel.permissionsFor(message.client.user);
	if (!permissions.has("CONNECT") || !permissions.has("SPEAK"))
	{
		var embed = new MessageEmbed()
			.setTitle("Lord please granteth me the permission to joineth and speaketh in thy holy voice channels.");
		return message.channel.send(embed);
	}

	// Resolve the requested content into a list of songs to add
	var songs = await getSongsInfo(contentToPlay);

	if (songs.length === 0)
	{
		return;
	}

	// Set the requester
	for (var song of songs)
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
			volume: 10,
			playing: -1,
		};

		// Add to queueMap
		queueMap.set(message.guild.id, newQueue);

		serverQueue = newQueue;
		
		// Join the voicechat
		newQueue.connection = await voiceChannel.join()
			.catch(error => 
				{
					queueMap.delete(message.guild.id);

					var embed = new MessageEmbed()
						.setTitle("Unexpected error joining voice chat. Please try again or bonk Frosty.")
						.setDescription("Error: " + error);
					return message.channel.send(embed);
				}
			);
	}

	// Add the songs
	const indexAdded = serverQueue.songs.length; // the added songs start from this index
	serverQueue.songs.push.apply(serverQueue.songs, songs);

	// UI messages
	if (songs.length === 1)
	{
		if (!isQueuePlaying(serverQueue)) // don't send queued message because we're gonna play this song right away
		{
			var embed = new MessageEmbed()
				.setTitle(`Queued ${songs[0].title}.`);
			message.channel.send(embed);
		}
	}
	else
	{
		var embed = new MessageEmbed()
			.setTitle(`Queued ${songs.length} songs`);
		message.channel.send(embed);
	}

	// If we are not playing anything, play the first added song
	if (!isQueuePlaying(serverQueue))
	{
		playSong(serverQueue, indexAdded);
	}
}

async function getSongsInfo(contentToPlay)
{
	var songs = [];

	// Youtube
	if (matchYoutubeUrl(contentToPlay))
	{
		// Single vid
		if (ytdl.validateURL(contentToPlay))
		{
			songInfo = await ytdl.getInfo(contentToPlay);
			const song =
			{
				title: songInfo.videoDetails.title,
				url: songInfo.videoDetails.video_url,
			};
			songs.push(song);
		}

		// Playlist
		else
		{
			const playistID = await ytpl.getPlaylistID(contentToPlay);
			const playlist = await ytpl(playistID, { limit : Infinity })
				.catch((error) => 
				{
					var embed = new MessageEmbed()
						.setTitle("Invalid link/playlist");
					return message.channel.send(embed);
				});

			for(var songInfo of playlist.items)
			{
				const song =
				{
					title: songInfo.title,
					url: songInfo.shortUrl,
				};
				songs.push(song);
			}
		}
	}

	// Title search
	else
	{
		console.log("Searching for video by title");

		// Get song from title
		const {videos} = await yts(contentToPlay);
		if (!videos.length)
		{
			var embed = new MessageEmbed()
				.setTitle("No songs found.");
			return message.channel.send(embed);
		}

		const song =
		{
			title: videos[0].title,
			url: videos[0].url,
		};

		songs.push(song);
	}

	return songs;
}

function playSong(serverQueue, index)
{
	serverQueue.playing = index;
	if (serverQueue.playing < 0 || serverQueue.playing >= serverQueue.songs.length)
	{
		var embed = new MessageEmbed()
			.setTitle(`Error playing song: song index in queue oob.`);
		return serverQueue.textChannel.send(embed);
	}
	
	const song = serverQueue.songs[serverQueue.playing];

	if (!song)
	{
		// Shouldn't get here but just in case
		var embed = new MessageEmbed()
			.setTitle(`Error playing song. Skipping to next...`);
		serverQueue.textChannel.send(embed);

		playNextSong(serverQueue);

		return;
	}

	var embed = new MessageEmbed()
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
			var embed = new MessageEmbed()
				.setTitle(errorStr);
			serverQueue.textChannel.send(embed);

			playNextSong(serverQueue);
			return;
		});

	dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);
}

function playNextSong(serverQueue)
{
	const nextSongIndex = serverQueue.playing + 1;
	if (nextSongIndex >= serverQueue.songs.length)
	{
		var embed = new MessageEmbed()
			.setTitle(`Reach the end of queue.`);
		return serverQueue.textChannel.send(embed);
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
		var embed = new MessageEmbed()
			.setTitle("The queue is currently empty.");
		return message.channel.send(embed);
	}

	// Display the page with currently played song
	const currentPage = Math.floor(serverQueue.playing / numSongsPerQueuePage);
	const queuedSongs = parseQueue(serverQueue, currentPage);
	const numPages = Math.ceil(serverQueue.songs.length / numSongsPerQueuePage);

	var embed = new MessageEmbed()
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
	const numPages = Math.ceil(serverQueue.songs.length / numSongsPerQueuePage);
	var embed = new MessageEmbed()
		.setTitle(`Current queue for #${message.channel.name}`)
		.setDescription(queuedSongs)
		.setFooter(`${pageIndex + 1}/${numPages}`);

	message.edit(embed);
}

async function leave(message, serverQueue)
{
	if (!message.guild.me.voice.channel)
	{
		var embed = new MessageEmbed()
			.setTitle(`I'm not currently in a voice channel.`);
		return message.channel.send(embed);;
	}

	await message.guild.me.voice.channel.leave();
	message.react(EMOTE_CONFIRM);
}

/// Helper functions /// 
function channelQueueCheck(message, serverQueue, dispatcherCheck = false)
{
	if (!message.member.voice.channel)
	{
		var embed = new MessageEmbed()
			.setTitle(`You need to be in a voice channel to use this command.`);
		message.channel.send(embed);
		return false;
	}
	
	if (!serverQueue)
	{
		var embed = new MessageEmbed()
			.setTitle(`No song has been queued.`);
		message.channel.send(embed);
		return false;
	}

	if (dispatcherCheck && !serverQueue.connection.dispatcher)
	{
		var embed = new MessageEmbed()
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
		var embed = new MessageEmbed()
			.setTitle(`Error displaying queue: page index oob`);
		return message.channel.send(embed);
	}

	var queuedSongs = "";
	
	const startIndex = pageIndex * numSongsPerQueuePage;
	const endIndex = Math.min(startIndex + numSongsPerQueuePage - 1, numSongs - 1);

	for (var songIndex = startIndex; songIndex <= endIndex; ++songIndex)
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

function matchYoutubeUrl(url)
{
	var p1 = /^.*(youtu.be\/|youtube.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})(?:\S+)?$/;
	var p2 = /^.*(youtu.be\/|list=)([^#\&\?]*).*/;
	if(url.match(p1))
	{
		if (url.match(p1)[1])
		{
			return true;
		}
	}
	if(url.match(p2))
	{
		if (url.match(p2)[1])
		{
			return true;
		}
	}
	return false;
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

// TODO: Check if member content/vids that it cant played breaks anything
// TODO: Shuffle
// TODO: Loop