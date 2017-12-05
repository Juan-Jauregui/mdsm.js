/* Node.js core libraries for HTTP/S and Crypto services */
const http = require("http");
const https = require("https");
const crypto = require('crypto');

/* Class to manage sessions */
const Session = require("./Classes/Session.js");

/* MDSM uses a revealing module pattern to expose a public API. It's a function with
 * internal variables and functions that returns an object with references to the
 * public interface. This ensures good encapsulation. */
let mdsm = function(){

	/* Configuration options: MDSM can run either in "Port" mode or in "Middleware" mode.
	 * Port mode opens up an HTTP server on a specified port and handles HTTP calls to
	 * that port directly. Middleware mode exposes the processRequest() method through
	 * the public interface, allowing the framework to be used as middleware for existing
	 * projects, particularly ones using the Express.js web application framework. */
	let MDSM_CONFIG = {
		mode: null,	// To be set upon initialization [init()]. Valid values: {'Port','Middleware'}
		port: null,	// Also to be set upon init(). HTTP/s server will listen on this port if on port mode.

		/* Cookies are dynamically encrypted and decrypted. This secret is a unique 256-bit
		 * key to be used for these purposes. */
		secret: crypto.randomFillSync(Buffer.alloc(256), 0, 256).toString('base64'),
	};

	/* Lists of Session instances. See Sessions.js class for schema. */
	let sessions = [];			// Will be populated with sessions as they are initialized

	/* List of Endpoints. See Documentation for object schema. */
	let endpoints = [];			// Will contain a list of valid endpoints

	/* Initializes an instance of MDSM in either 'Port' mode (which listens for requests
	 * on a specified port) or "Middleware" mode, which allows the processRequest function
	 * to be  */
	let init = function(initConfig){
		if(initConfig.mode === 'Port'){
			MDSM_CONFIG.mode = 'Port';			// Declare the mode to 'Port'
			MDSM_CONFIG.port = initConfig.port;	// Define the port number
			listen(initConfig);					// Initialize an HTTP/S server
		}

		else if(initConfig.mode === 'Middleware'){
			MDSM_CONFIG.mode = 'Middleware';			// Declare the mode to 'Port'
		}

		/* Save the list of valid endpoint-allowedClassType-handler objects, but first trims
		 * the url so that it's uniform */
		endpoints = initConfig.endpoints.map((endpoint)=>{
			endpoint.url = trimURL(endpoint.url);
			return endpoint;
		});
	}

	/* This requestListener is used as a callback function in Port mode. It simply calls
	 * processRequest() on incoming requests. */
	let requestListener = function(req,res,next){
		processRequest(req,res,next);
	}

	/* Configures HTTP/s server when using Port mode.
	 * Listens for requests on a specified port. See documentation for "config" schema */
	let listen = function(config){
		/* If HTTPS settings were specified, configure an HTTPS server. */
		if(config.https){
			/* Use the key, certificate, and (optional) passphrase and ca fields passed in */
			try{
				let server = https.createServer({
					'key': config.https.key,
					'cert': config.https.cert,
					'passphrase': config.https.passphrase,	// Optional. May be null.
					'ca': config.https.ca						// Optional. May be null.
				},requestListener);
				server.listen({
					'port': MDSM_CONFIG.port,
					'host': '0.0.0.0',
				});
				console.log('MDSM Listening for HTTPS on port ' + MDSM_CONFIG.port);
			} catch(error){
				console.log('MDSM error: Failed to initialize HTTPS server. Double check the configurations.');
				console.log(error.stack);
			}
		}

		/* If no HTTPS settings were specified, default to an HTTP server. */
		else {
			try{
				let server = http.createServer(requestListener);
				server.listen({
					'port': MDSM_CONFIG.port,
					'host': '0.0.0.0',
				});
				console.log('MDSM Listening for HTTP on port ' + MDSM_CONFIG.port);
			} catch(error){
				console.log('MDSM error: Failed to initialize HTTP server');
			}
		}
	}

	/* The true implementation of the public processRequest() function. Only calls
	 * processRequest() if MDSM was configured to run in Middleware mode.
	 * it throws an error.*/
	let processRequestAsMiddleware = function(req,res,next){
		if(MDSM_CONFIG.mode != 'Middleware'){
			next({
				errorCode: 2,	// Error code 2: Invalid MDSM cookie
				errorText: 'MDSM Error: processRequest() unavailable in Port mode.\
				 				Use Middleware mode, or route requests directly to the \
								port specified on initialization.',
			});
		} else {
			processRequest(req,res,next);
		}
	}

	/* Process an incoming request. This function may be called by the request listener,
	 * if listening on a port, or manually through the external API. */
	let processRequest = function(req,res,next){
		let reqUrl = trimURL(req.url);	//Get a trimmed version of the URL

		/* If the url is not a valid endpoint, use the "next" parameter to
		 * to throw an error. */
		if(!(isValidEndpoint(reqUrl))){
			next({
				errorCode: 3,	// Error code 3: Invalid endpoint URL
				errorText: 'Invalid endpoint'
			});
		}

		/* If the request was for a valid URL, continue processing the request */
		else {
			/* Get an object containing cookie-value pairs. If there are no cookies,
			 * the list may be empty. */
			let cookieList = getCookieListFromReq(req);

			/* If the request has an MDSM cookie */
			if(cookieList['mdsm']){
				/* Look for a session associated with the cookie by passing the MDSM cookie
				 * to the findSession() function, which will attempt to decrypt it and return t
				 * the matching session. If no session is found or the cookie cannot be decrypted,
				 * the function will return null. */
				let match = findSession(cookieList['mdsm']);

				/* If a session exists */
				if(match){
					/* Tell the session to process the request. Also append an unencrypted version
					 * of the MDSM cookie as the third parameter */
					match.session.processRequest(req,res,match.mdsmCookie,next);
				}

				/* If no valid session could be ascertained from the cookie (either because it could
				 * not be decrypted, or because the session does not exist), expire the bad cookie
				 * and pass an error to the caller through the next() callback */
				else {
					next({
						errorCode: 1,	// Error code 1: Invalid MDSM cookie
						errorText: 'MDSM Error: Invalid MDSM cookie. Could not find matching session.',
					});

				}
			}

			/* If the request does not have an MDSM cookie... */
			else {
				/* If on port mode, send an HTTP 400 response */
				if(MDSM_CONFIG.mode === 'Port'){
					res.statusCode = 400;
					res.end("Not an MDSM request");
				}
				/* If on Middleware mode, call the callback with an error code of 0, signaling that this was
				 * a request without an MDSM cookie */
				else {
					next({
						errorCode: 0,	// Error code 0: No MDSM cookie
						errorText: 'Not an MDSM request (no MDSM cookie)'
					});
				}
			}
		}
	}

	/* Checks the list of endpoints to see whether a given URL pertains to a valid endpoint.*/
	function isValidEndpoint(url){
		/* Get a subset of the endpoints array for which the url matches the given url (trimmed) */
		let matchingEndpoints = endpoints.filter((ep)=>{
			return ep.url === trimURL(url);
		});

		/* If the subset is not an empty set, return true. Otherwise return false. */
		return (matchingEndpoints.length != 0);
	}

	/* Takes an HTTP request object and returns a list of its cookies */
	function getCookieListFromReq(request) {
		var list = {},
		cookieString = request.headers.cookie;
		cookieString && cookieString.split(';').forEach(function( cookie ) {
			let parts = cookie.split('=');
			list[parts.shift().trim()] = decodeURI(parts.join('='));
		});

		return list;
	}

	/* Takes an encrypted MDSM cookie, decrypts it, and attempts to find a session
	 * in the sessions array with a matching sessionID. Returns either an object containing
	 * the decrypted cookie and a reference to the Session object, or null if no matching
	 * session is found. */
	function findSession(sessionCookie){
		try{
			/* Decrypt the session cookie string */
			let unencrypted = decrypt(sessionCookie);

			/* Parse it into an object */
			let sessionDataObject = JSON.parse(unencrypted);

			/* Get a subset of the sessions list with elements whose sessionIDs match
			 * the ones in the MDSM cookie. */
			let filteredSessionList = sessions.filter((s)=>{
				return s.sessionID === sessionDataObject.sessionID;
			});

			/* IF the subset is of positive length, a match was found. Return an object
			 * with the unencrypted cookie and a reference to the matching Session */
			if(filteredSessionList.length > 0){
				return {
					mdsmCookie: unencrypted,
					session: filteredSessionList[0]
				};
			}

			/* If no match was found, return null */
			else {
				return null;
			}
		}

		/* If the cookie could not be decrypted:  */
		catch(error){
			console.log(`MDSM error: Unable to decrypt MDSM cookie:\n\t[${sessionCookie}].\n` +
							`It may have been generated by a previous instance of MDSM.`
			);
			return null;
		}

		/* Return null if no matching session could be discerned */
		return null;
	}

	/* Create a session using a configuration object. See Documentation for schema. */
	let createSession = function(newSessionInfo){
		/* If a session ID wasn't specified, create a random 32-bit hex-encoded ID */
		if(!(newSessionInfo.sessionID)){
			newSessionInfo.sessionID = crypto.randomFillSync(Buffer.alloc(32), 0, 32).toString('hex');
		};

		/* If no session TTL was specified, default to 0. */
		if(!(newSessionInfo)){
			newSessionInfo.timeToLive = 0;
		}

		/* If no sessionData was provided, make sure it's null rather than undefined. */
		if(!(newSessionInfo.sessionData)){
			newSessionInfo.sessionData = null;
		}

		/* Create a new session */
		let newSesh = new Session({
			sessionID: newSessionInfo.sessionID,
			expiryDate: Date.now() + newSessionInfo.timeToLive,
			sessionData: newSessionInfo.sessionData,
			validEndpoints: endpoints,		// Give the session a reference to the Endpoints list
		});

		/* Add the session to the sessions array */
		sessions.push(newSesh);

		/* The following function will be set on a timer to be called once the session is supposed to expire. */

		/* Tells the session object to delete itself. If it does, the session truly expired,
		 * so it is deleted from the sessions array. If it does not delete itself, that means
		 * that its expiryDate was extended, so the session has not truly expired yet. In that case,
		 * set a new timeout to attempt to expire the session again at the new expiryDate. */
		function expireSession(session){
			/* Attempt to delete the session object (deletion will only succeed if the session
			 * has truly reached its expiryDate, without being renewed to extend its life) */
			let wasDestroyed = session.attemptSelfDestruct();

			/* If the session was expired and was successfully deleted, remove it from the sessions array */
			if(wasDestroyed){
				/* Find the index of the session object in the sessions array, and delete it */
				sessions.splice(sessions.indexOf(session),1);	//Delete 1 object at the index of the session
				session = null;	// Set the session object equal to null to ensure the garbage collector catches it
			}

			/* If the session was not deleted, its expiryDate is in the future. Set a new timeout */
			else {
				setTimeout(
					()=>{expireSession(session)},
					session.expiryDate - Date.now()
				);
			}
		}

		/* Set an initial callback to delete the session at expiry time. Self-destruction is not
		 * guaranteed since (by design), the session may have its expiryDate extended before
		 * the callback is executed. */
		setTimeout(
			()=>{expireSession(newSesh);},		// The function that will expire the session
			newSessionInfo.timeToLive	// To be called after the session's TTL has transpired
		);

		/* Return a reference to the new Session object */
		return newSesh;
	}

	/* Extend the life of a session by a specified number of milliseconds */
	let renewSession = function(sessionID, extraTimeInMs){
		/* Find the session with the given sessionID */
		let session = sessions.filter((s)=>{
			return s.sessionID === sessionID;
		})[0];

		/* Extend the session's life by the specified number of milliseconds */
		session.extendSessionLife(extraTimeInMs);
	}

	/* Add a client based on info passed in. See documentation for newClientInfo schema.
	 * Returns either the new client's encrypted cookie, or null if the client could not
	 * be created. */
	let addClient = function(newClientInfo){
		console.log("Trying to create a client on session " + newClientInfo.session);
		console.log("Sessions: ");
		console.log(sessions);
		/* get the session from the newClientinfo */
		var session;// = newClientInfo.session;

		/* If Session was passed in as a sessionID instead of a Session object, get the
		 * appropriate object from the list of sessions. */
		if(!(typeof newClientInfo.session === 'object')){
			session = sessions.filter((s)=>{
				return s.sessionID === newClientInfo.session;
			})[0];

			/* If the session could not be found, return null */
			if(!(session)){
				return null;
			}
		}

		/* If the Session instance was passed directly, just use it. */
		else session = newClientInfo.session;

		/* Tell the session to create a new client, which returns a client cookie */
		let clientCookie = session.addClient({
			clientClass: newClientInfo.clientClass,
			clientData: newClientInfo.clientData,
		});

		/* Return the client cookie ciphertext */
		return encrypt(clientCookie);
	}

	/* If the URL starts or begins with slashes, trims it to remove them. For consistency
	 * in adding and comparing endpoint URLs. */
	function trimURL(url){
		let trimmedUrl = url;
		if(trimmedUrl.charAt(0) === '/'){
			trimmedUrl = trimmedUrl.substring(1,trimmedUrl.length);
		}
		if(trimmedUrl.charAt(trimmedUrl.length - 1) === '/'){
			trimmedUrl = trimmedUrl.substring(0,trimmedUrl.length - 1);
		}
		return trimmedUrl;
	}

	/* Performs AES-256 encryption on a plaintext using a randomly-generated key
	 * unique to each instance of MDSM */
	function encrypt(plaintext){
		const encipher = crypto.createCipher('aes256', MDSM_CONFIG.secret);
		let encrypted = encipher.update(plaintext, 'utf8', 'base64');
		encrypted += encipher.final('base64');
		return encrypted;
	}

	/* Decrypts a ciphertext generated by the above encrypt function.
	 * Returns null if the ciphertext is invalid */
	function decrypt(ciphertext){
		// console.log(`Decrypting ciphertext: ${ciphertext}`);
		const decipher = crypto.createDecipher('aes256', MDSM_CONFIG.secret);
		try{
			let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
			decrypted += decipher.final('utf8');
			// console.log('Decrypted: ' + decrypted);
			return decrypted;
		} catch (error){
			throw error;
			return null;
		}
	}

	/* Revealing Module design pattern: Define the module's external public functions */
	let externalAPI = {
		init: init,
		createSession: createSession,
		renewSession: renewSession,
		addClient: addClient,

		/* Expose processRequest() via an alias that acts as a gatekeeper. */
		processRequest: processRequestAsMiddleware,
	};

	/* Return the external API */
	return externalAPI;
}

/* Execute mdsm() and return that as the module export. */
module.exports = mdsm();
