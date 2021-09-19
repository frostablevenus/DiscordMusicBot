/// Dependencies
const Discord = require('discord.js');
const { Permissions } = require('discord.js');
const fs = require('fs');

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

/// Some global settings
const numSongsPerQueuePage = 10;
const defaultPrefix = '~';

/// Data ///
const queueMap = new Map();

var commands = [];
var serverPrefixes = [];
var personalLists = [];
{
	// Separate try catches since we dont want to fail the rest if any of them fail.
	try
	{
		commands = require('./commands.json').commands;
	} 
	catch (error)
	{
	}
	
	try
	{
		// For permission hexcodes, refer to https://discord.com/developers/docs/topics/permissions.
		serverPrefixes = require('./prefixes.json').serverPrefixes;
	} 
	catch (error)
	{
	}
	
	try
	{
		personalLists = require('./personalLists.json').personalLists;
	}
	catch (error)
	{
	}
}


//////////////////////////////////////////////////////////////////////////////
/// ---------------------------------------------------------------------- ///
//////////////////////////////////////////////////////////////////////////////
/// Login ///
var client = new Discord.Client();
try 
{
	let token;

	// Look for env variable, if that doesn't exist then pull from local config
	if (!process.env.DJS_TOKEN)
	{
		const data = fs.readFileSync("./config.json");
		const obj = JSON.parse(data);
		token = obj.token;
	}

	if (!process.env.DJS_TOKEN && token === "")
	{
		throw ("No token found.");
	}

	client.login(process.env.DJS_TOKEN ? process.env.DJS_TOKEN : token);
}
catch (error)
{
	console.log("Encountered error starting up: " + error);
}

/// Listeners ///
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

client.on('message', async message =>
{
	// Ignore other bot messages
	if (message.author.bot)
	{
		return;
	}

	// Does this command start with this bot being mention?
	const myId = message.guild.me.id;
	const startsWithMention = message.content.startsWith(`<@${myId}>`) || message.content.startsWith(`<@!${myId}>`);

	// Does this command start with the set prefix?
	const prefix = getServerPrefix(message.guild);
	const startsWithPrefix = message.content.startsWith(prefix);
	
	if (!startsWithMention && !startsWithPrefix)
	{
		return;
	}

	const args = parseMessageToArgs(message);

	// Permission check
	if (!userHasPermission(message.member, args.commandName))
	{
		let embed = new MessageEmbed()
			.setTitle(`You do not have permission to run this command.`);
		message.channel.send(embed);
		return;
	}

	const serverQueue = queueMap.get(message.guild.id);

	switch(args.commandName)
	{
		case `prefix`:
		{
			if (args.extraArgs != "")
			{
				const newPrefix = args.extraArgs;

				setServerPrefix(message.guild.id, newPrefix);

				// Stringify and write to file
				let data = 
				{
					"serverPrefixes" : serverPrefixes
				}
				let dataStr = JSON.stringify(data, null, 2);

				fs.writeFile("prefixes.json", dataStr, function (error)
				{
					if (error) 
					{
						let embed = new MessageEmbed()
							.setTitle(`Failed to set prefix to ${newPrefix}`);
						message.channel.send(embed);
						console.log(error);
						return;
					}
				});

				let embed = new MessageEmbed()
					.setTitle(`Prefix set to ${newPrefix}`);
				message.channel.send(embed);
			}
			else
			{
				let embed = new MessageEmbed()
					.setTitle(`Usage: ${prefix}prefix [new prefix]`);
				message.channel.send(embed);
			}
			
			return;
		}
			
		case `play`:
		{
			queueSong(message, serverQueue);
			return;
		}

		case `pause`:
		{
			pause(message, serverQueue);
			return;
		}

		case `resume`:
		{
			resume(message, serverQueue);
			return;
		}

		case `seek`:
		{
			seek(message, serverQueue);
			return;
		}

		case `next`:
		{
			next(message, serverQueue);
			return;
		}

		case `skip`:
		{
			skip(message, serverQueue);
			return;
		}

		case `clear`:
		{
			clear(message, serverQueue);
			return;
		}

		case `remove`:
		{
			remove(message, serverQueue);
			return;
		}

		case `queue`:
		{
			getQueue(message, serverQueue);
			return;
		}

		case `nowplaying`:
		{
			getNowPlaying(message, serverQueue);
			return;
		}
			
		case `shuffle`:
		{
			shuffle(message, serverQueue);
			return;
		}

		case `loop`:
		{
			loop(message, serverQueue);
			return;
		}

		case `list`:
		{
			list(message, serverQueue);
			return;
		}

		case `leave`:
		{
			leave(message, serverQueue);
			return;
		}

		case `help`:
		{
			help(message, serverQueue);
			return;
		}

		default:
		{
			let embed = new MessageEmbed()
				.setTitle(`Command not found, please refer to ${prefix}help for more information.`);
			return message.channel.send(embed);
		}
	}
})

client.on('messageReactionAdd', (reaction, user) =>
{
	let message = reaction.message;
	let emoji = reaction.emoji;

	if (message.author.id != client.user.id) // Only handle reactions on our messages
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
	if (embed.title.startsWith(`Current queue`))
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
	const args = parseMessageToArgs(message);
	const contentToPlay = args.extraArgs;

	// Error checking
	if (!channelQueueCheck(message, serverQueue, false, false))
	{
		return;
	}

	if (contentToPlay == "")
	{
		let embed = new MessageEmbed()
			.setTitle("Please enter a URL or title.");
		return message.channel.send(embed);
	}
	
	const voiceChannel = message.member.voice.channel;

	const permissions = voiceChannel.permissionsFor(message.client.user);
	if (!permissions.has("CONNECT") || !permissions.has("SPEAK"))
	{
		let embed = new MessageEmbed()
			.setTitle("Lord please granteth me the permission to joineth and speaketh in thy holy voice channels.");
		return message.channel.send(embed);
	}

	if (!serverQueue)
	{
		try
		{
			serverQueue = await createServerQueueAndJoinVoice(message, serverQueue);
		}
		catch (error)
		{
			// Ran into some error while creating the server queue, abort
			return;
		}
	}

	// Resolve the requested content into a list of songs to add
	let songs = await getSongsInfo(message, contentToPlay);
	if (songs.length === 0)
	{
		// No need to send anything here because getSongsInfo already has error checking.
		return;
	}
	// Set the requester
	for (let song of songs)
	{
		song.addedBy = message.author.id;
	}

	// Add the songs
	const indexAdded = serverQueue.songs.length; // the added songs start from this index
	serverQueue.songs.push.apply(serverQueue.songs, songs);

	// UI messages
	if (songs.length === 1)
	{
		// send queue message if queue is playing, otherwise we're gonna play this song right away
		if (isQueuePlaying(serverQueue)) 
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
		let playlist;
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

function playSong(serverQueue, index, seekTo = 0)
{
	serverQueue.playingIndex = index;
	if (serverQueue.playingIndex < 0 || serverQueue.playingIndex >= serverQueue.songs.length)
	{
		let embed = new MessageEmbed()
			.setTitle(`Error playing song: song index in queue oob.`);
		serverQueue.defaultTextChannel.send(embed);
		return;
	}
	
	const song = serverQueue.songs[serverQueue.playingIndex];

	if (!song)
	{
		// Shouldn't get here but just in case
		let embed = new MessageEmbed()
			.setTitle(`Unexpected error reading song info. Skipping to next...`);
		serverQueue.defaultTextChannel.send(embed);

		playNextSong(serverQueue);

		return;
	}

	if (seekTo === 0)
	{
		let embed = new MessageEmbed()
			.setTitle("Now playing")
			.setDescription(`**[${song.title}](${song.url})** [<@${song.addedBy}>]`);
		serverQueue.defaultTextChannel.send(embed);
	}

	// Play the song on our set connection
	// dispatcher is like a handle returned by .play(), and is set automatically on the connection by calling this function.
	const stream = ytdl(song.url);

	const dispatcher = serverQueue.connection
		.play(stream, { seek : seekTo })
		.on("finish", () =>
		{
			playNextSong(serverQueue);
		})
		.on("error", error => 
		{
			const errorStr = "Error encountered while playing video: " + error.toString().replace('Error: input stream: ', '');
			let embed = new MessageEmbed()
				.setTitle(errorStr);
			serverQueue.defaultTextChannel.send(embed);

			playNextSong(serverQueue);
		});

	if (dispatcher)
	{
		dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);
	}
}

async function playNextSong(serverQueue)
{
	let nextSongIndex = serverQueue.playingIndex + 1;
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
			return serverQueue.defaultTextChannel.send(embed);
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

function seek(message, serverQueue)
{
	if (!channelQueueCheck(message, serverQueue, true))
	{
		return;
	}

	const args = parseMessageToArgs(message);
	const seconds = parseTimeString(args.extraArgs);

	if (seconds < 0)
	{
		let embed = new MessageEmbed()
			.setTitle(`Please enter a valid time. Format: "secs", "mins:secs", etc.'`);
		message.channel.send(embed);
		return;
	}

	// TODO: Maybe end current dispatcher to fix the speed problem
	playSong(serverQueue, serverQueue.playingIndex, seconds);
	message.react(EMOTE_CONFIRM);
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

function skip(message, serverQueue)
{
	if (!channelQueueCheck(message, serverQueue))
	{
		return;
	}

	const args = parseMessageToArgs(message);
	if (args.extraArgs === "")
	{
		// Treat this as skipping to the next song
		next(message, serverQueue);
		return;
	}

	const inputIndex = parseInt(args.extraArgs);
	if (isNaN(inputIndex) || inputIndex - 1 < 0 || inputIndex - 1 >= serverQueue.songs.length)
	{
		let embed = new MessageEmbed()
			.setTitle(`Please enter a valid index. Usage: skip [number in queue].`);
		message.channel.send(embed);
		return;
	}

	if (serverQueue.connection.dispatcher)
	{
		serverQueue.playingIndex = inputIndex - 2; // Setting it to the previous song, it'll go to the wanted song when we end the current one.
		serverQueue.connection.dispatcher.end();
	}
	else
	{
		playSong(serverQueue, inputIndex - 1);
	}
}

function clear(message, serverQueue)
{
	if (!channelQueueCheck(message, serverQueue))
	{
		return;
	}

	cleanUpServerQueue(serverQueue);
	
	message.react(EMOTE_CONFIRM);
}

function remove(message, serverQueue)
{
	if (!channelQueueCheck(message, serverQueue))
	{
		return;
	}

	const args = parseMessageToArgs(message);
	const inputIndex = parseInt(args.extraArgs);
	if (isNaN(inputIndex) || inputIndex - 1 < 0 || inputIndex - 1 >= serverQueue.songs.length)
	{
		let embed = new MessageEmbed()
			.setTitle(`Please enter a valid index. Usage: remove [number in queue].`);
		message.channel.send(embed);
		return;
	}

	const indexToRemove = inputIndex - 1;
	const songToRemove = serverQueue.songs[indexToRemove];
	serverQueue.songs.splice(indexToRemove, 1);

	if (serverQueue.playingIndex >= indexToRemove)
	{
		if (serverQueue.playingIndex === indexToRemove)
		{
			if (serverQueue.connection.dispatcher)
			{
				serverQueue.connection.dispatcher.end();
			}
		}

		--serverQueue.playingIndex;
	}

	var removeStr = "Removed " + inputIndex.toString() + ". " + songToRemove.title + "\n" ;
	let embed = new MessageEmbed()
		.setTitle(removeStr);
	message.channel.send(embed);
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
	const nowPlaying = Math.min(Math.max(serverQueue.playingIndex, 0), numSongs - 1); // Bound to [0..numsongs - 1]
	const currentPage = Math.floor(nowPlaying / numSongsPerQueuePage);
	const queuedSongs = parseQueue(message, currentPage, serverQueue.songs, serverQueue.playingIndex, isQueuePlaying(serverQueue));
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
	const queuedSongs = parseQueue(message, pageIndex, serverQueue.songs, serverQueue.playingIndex, isQueuePlaying(serverQueue));
	if (queuedSongs === "")
	{
		return;
	}

	const numPages = Math.ceil(serverQueue.songs.length / numSongsPerQueuePage);
	let embed = new MessageEmbed()
		.setTitle(message.embeds[0].title)
		.setDescription(queuedSongs)
		.setFooter(`${pageIndex + 1}/${numPages}`);

	message.edit(embed);
}

function getNowPlaying(message, serverQueue)
{
	if (!channelQueueCheck(message, serverQueue))
	{
		return;
	}

	const song = serverQueue.songs[serverQueue.playingIndex];
	let embed = new MessageEmbed()
		.setTitle("Now playing")
		.setDescription(`**[${song.title}](${song.url})** [<@${song.addedBy}>]`);
	message.channel.send(embed);
}

function shuffle(message, serverQueue)
{
	if (!channelQueueCheck(message, serverQueue))
	{
		return;
	}

	// Walk the queue and swap each song with a random lower one. Don't shuffle the current song.
	for (let i = serverQueue.songs.length - 1; i > 0; i--)
	{
		if (i == serverQueue.playingIndex)
		{
			continue;
		}

        var j = Math.floor(Math.random() * (i + 1));
		while (j === serverQueue.playingIndex)
		{
			j = Math.floor(Math.random() * (i + 1));
		}

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

async function list(message, serverQueue)
{
	function printUsage()
	{
		let embed = new MessageEmbed()
			.setTitle(`Usage: "list [save/load] [name]" | "list view"`);
		message.channel.send(embed);
	}

	const args = parseMessageToArgs(message);
	const extraArgs = args.extraArgs;
	
	const listCommand = extraArgsList[0].toLowerCase();
	const listName = extraArgsList.slice(1).join(" ");

	if (!["save", "load", "view"].includes(listCommand))
	{
		printUsage();
		return;
	}

	// Collection of playlists belonging to this user
	let userLists = null;
	// The playlist with the name entered. Might not yet exist.
	let userList = null;

	// Try to find both userLists & userList
	for (let listCollection of personalLists)
	{
		if (listCollection.userId === message.author.id)
		{
			userLists = listCollection.lists;
			for (let list of userLists)
			{
				if (list.name === listName)
				{
					userList = list;
					break;
				}
			}

			break;
		}
	}

	switch (listCommand)
	{
		case "save":
		{
			if (!channelQueueCheck(message, serverQueue))
			{
				return;
			}

			if (listName === "")
			{
				printUsage();
				return;
			}

			if (serverQueue.songs.length === 0)
			{
				// Interpretting this as deleting the list.
				if (userLists && userList)
				{
					userLists.splice(userLists.indexOf(userList), 1);
				}
			}

			// Get a list of songs from the current queue
			let newSongs = [];
			for (let song of serverQueue.songs)
			{
				const newSong = 
				{
					title: song.title,
					url: song.url
				}
				newSongs.push(newSong);
			}

			// Update the existing playlist
			if (userList)
			{
				userList.songs = newSongs;
			}
			// Create a new playlist
			else
			{
				const newUserList =
				{
					name: listName,
					songs : newSongs
				}

				// Add or existing list collection
				if (userLists)
				{
					userLists.push(newUserList);
				}
				// Create a new list collection
				else
				{
					let newListCollection =
					{
						userId: message.author.id,
						lists: [newUserList]
					};
					personalLists.push(newListCollection);
				}
			}

			// Stringify and write to file
			let data = 
			{
				"personalLists" : personalLists
			}
			let dataStr = JSON.stringify(data, null, 2);

			fs.writeFile("personalLists.json", dataStr, function (error)
			{
				if (error) 
				{
					let embed = new MessageEmbed()
						.setTitle(`Failed to save playlist.`);
					message.channel.send(embed);
					console.log(error);
					return;
				}
			});

			let embed = new MessageEmbed()
				.setTitle(`Saved playlist ${listName}`);
			message.channel.send(embed);

			break;
		}

		case "load":
		{
			if (!channelQueueCheck(message, serverQueue, false, false))
			{
				return;
			}

			if (listName === "")
			{
				printUsage();
				return;
			}

			if (userList === null)
			{
				let embed = new MessageEmbed()
					.setTitle(`Playlist not found.`);
				message.channel.send(embed);
				return;
			}

			if (userList.songs.length === 0)
			{
				let embed = new MessageEmbed()
					.setTitle(`This playlist is empty.`);
					message.channel.send(embed);
			}

			// This is a hack because ending the current stream would make it move on to the next song, and since we're adding
			// new songs to the queue it would go to the first song in the list.
			let bWasQueuePlaying = isQueuePlaying(serverQueue);
			if (serverQueue)
			{	
				if (bWasQueuePlaying)
				{
					serverQueue.playingIndex = -1;
				}

				cleanUpServerQueue(serverQueue);
			}
			else
			{
				try
				{
					serverQueue = await createServerQueueAndJoinVoice(message, serverQueue);
				}
				catch (error)
				{
					// Ran into some error while creating the server queue, abort
					return;
				}
			}

			serverQueue.songs = userList.songs;
			for (let song of serverQueue.songs)
			{
				song.addedBy = message.author.id;
			}

			let embed = new MessageEmbed()
				.setTitle(`Queued ${serverQueue.songs.length} songs`);
			message.channel.send(embed);

			if (!bWasQueuePlaying)
			{
				playSong(serverQueue, 0);
			}

			break;
		}

		case "view":
		{
			if (!userLists || userLists.length === 0)
			{
				let embed = new MessageEmbed()
					.setTitle(`You do not have any saved playlist.`);
				message.channel.send(embed);
				return;
			}

			let playlistStr = "";
			for (let list of userLists)
			{
				playlistStr += list.name + "\n";
			}

			let embed = new MessageEmbed()
				.setTitle(`${message.author.username}'s playlists`)
				.setDescription(playlistStr);
			message.channel.send(embed);
			break;
		}

		default:
		{
			printUsage();
			return;
		}
	}
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

function help(message, serverQueue)
{
	let helpStr = "";
	for (let command of commands)
	{
		helpStr += "**" + command.name;
		if (command.aliases.length > 0)
		{
			helpStr += " (";
			for (let alias of command.aliases)
			{
				helpStr += alias + ", ";
			}
			helpStr = helpStr.substring(0, helpStr.length - 2);
			helpStr += ")";
		}
		helpStr += "**: " + command.description + "\n\n";
	}

	let embed = new MessageEmbed()
		.setTitle("List of commands")
		.setDescription(helpStr);
	message.channel.send(embed);
}

/// Logistics ///
function userHasPermission(user, commandName)
{
	for (let command of commands)
	{
		if (commandName === command.name)
		{
			if (!user.permissions.has(command.permissionsRequired, true)) // true = admin overrides
			{
				return false;
			}
		}
	}

	return true;
}

async function createServerQueueAndJoinVoice(message)
{
	const voiceChannel = message.member.voice.channel;

	// Creating the a new queue for our queueMap
	let newServerQueue =
	{
		defaultTextChannel: message.channel, // to automatically send errors when not responding to a specific user message.
		voiceChannel: voiceChannel,
		connection: null,
		songs: [],
		volume: 5,
		playingIndex: -1,
		looping: false,
	};

	// Add to queueMap
	queueMap.set(message.guild.id, newServerQueue);

	// Join the voicechat
	try
	{
		newServerQueue.connection = await voiceChannel.join();
		newServerQueue.connection.voice.setSelfDeaf(true);
	}
	catch (error)
	{
		queueMap.delete(message.guild.id);

		let embed = new MessageEmbed()
			.setTitle("Unexpected error joining voice chat.")
			.setDescription("Error: " + error)
			.setFooter("Please try again or bonk Frosty");

		cleanUpServerQueue(newServerQueue, message.guild.id, true);
		message.channel.send(embed);

		throw(error);
	}

	return newServerQueue;
}

async function cleanUpServerQueue(serverQueue, guildId = -1, bDeleteQueue = false, bLeaveVoice = false)
{
	if (serverQueue)
	{
		serverQueue.songs = [];

		if (serverQueue.connection && serverQueue.connection.dispatcher)
		{
			serverQueue.connection.dispatcher.end();
		}

		if (bLeaveVoice && serverQueue.voiceChannel)
		{
			serverQueue.voiceChannel.leave();
		}
	}

	if (bDeleteQueue && guildId >= 0)
	{
		queueMap.delete(guildId);
	}
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

function parseQueue(message, pageIndex, songs, playingIndex, hasActiveSong)
{
	const numSongs = songs.length;
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
		const song = songs[songIndex];
		const bIsCurrentSong = (songIndex === playingIndex) && hasActiveSong;

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
	return serverQueue && serverQueue.connection && serverQueue.connection.dispatcher;
}

function getServerPrefix(server)
{
	for (let serverPrefix of serverPrefixes)
	{
		if (serverPrefix.serverId === server.id)
		{
			return serverPrefix.prefix;
		}
	}

	return defaultPrefix;
}

function setServerPrefix(serverId, newPrefix)
{
	let foundPrefixEntry = false;
	for (let i = 0; i < serverPrefixes.length; ++i)
	{
		let serverPrefix = serverPrefixes[i];
		if (serverPrefix.serverId === serverId)
		{
			if (newPrefix === defaultPrefix)
			{
				serverPrefixes.splice(i, 1);
			}
			else
			{
				serverPrefix.prefix = newPrefix;
			}

			foundPrefixEntry = true;
			break;
		}
	}

	if (!foundPrefixEntry)
	{
		// Put this into the json obj array
		serverPrefixes.push(
		{
			"serverId" : serverId,
			"prefix" : newPrefix
		});
	}
}

function parseMessageToArgs(message)
{
	let commandName;
	const prefix = getServerPrefix(message.guild);
	const args = message.content.split(" ");

	let extraArgs = "";

	if (message.content.startsWith(prefix))
	{
		commandName = args[0].slice(prefix.length);
		extraArgsList = args.slice(1); // skips [prefix][command name]
	}
	else
	{
		commandName = (args.length > 1) ? args[1] : "";
		extraArgsList = args.slice(2); // skips the mention and command name
	}

	extraArgs = extraArgsList.join(" ");

	// Convert aliases to names
	for (let command of commands)
	{
		if (commandName === command.name)
		{
			break;
		}
		if (command.aliases.includes(commandName))
		{
			commandName = command.name;
			break;
		}
	}

	const outArgs =
	{
		commandName: commandName,
		extraArgs: extraArgs,
		extraArgsList: extraArgsList
	}

	return outArgs;
}

function parseTimeString(timeStr, outSeconds)
{
	if (timeStr === "")
	{
		return -1;
	}

	// Split the string at the colons (HH:MM:SS format)
	let timeArgs = timeStr.split(':'); 
	if (timeArgs.length <= 0)
	{
		return -1;
	}

	// Parse to int, returning on error
	let timeNums = [];
	for (let timeArg of timeArgs)
	{
		const timeNum = parseInt(timeArg);
		if (isNaN(timeNum))
		{
			return -1;
		}
		if (timeNum < 0)
		{
			return -1;
		}
		timeNums.push(timeNum);
	}

	let seconds = 0;
	for (let i = timeNums.length - 1; i >= 0; --i)
	{
		seconds += Math.pow(60, timeNums.length - 1 - i) * timeNums[i];
	}

	return seconds;
}

// TODO: More testing to check if stuff that cant be played (member content/private vids, etc.) breaks anything
// TODO: Personal playlists, investigate DB usage probably