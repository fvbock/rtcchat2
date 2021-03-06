// rtcchat2 rtcchat.js
// Copyright 2013 Timur Mehrvarz <timur.mehrvarz@riseup.net>
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var con = {'optional': [{'DtlsSrtpKeyAgreement': true}, {'RtpDataChannels': true }] };
var websocket = null,
	clientId = null,
	clientCount = 0,
	currentRoom = null,
	localOffer = null,
	IAmUser = 0;
var icecfg;
var pc1 = null;
var pc2 = null;
var webrtcDataChannel = null;
var roomName = null;
var linkType = null; // default null=p2p; option="relayed"
var key = null;
var calleeKey = null;

$('#waitForConnection').modal('hide');

window.onload = init;
function init() {
    // wsPort, stunPort  and stunhostvalues will be patched by rtcSignaling.go service
    var host = location.hostname;
    var stunHost = "{{.StunHost}}";
    if(stunHost=="") {
      stunHost = host;
    }
    linkType = "relayed"
    console.log("start: host/stunHost",host,stunHost);

    var wsPort = {{.SigPort}};    // default=8077
    var stunPort = {{.StunPort}}; // default=19253
    console.log("start: wsPort/stunPort",wsPort,stunPort);

    icecfg = {"iceServers":[{"url":"stun:"+stunHost+":"+stunPort}]};
    var	socketServerAddress;
	if(window.location.href.indexOf("https://")==0)
		socketServerAddress = "wss://"+host+":"+wsPort+"/ws";
	else
		socketServerAddress = "ws://"+host+":"+wsPort+"/ws";

	try {
		navigator.sayswho= (function(){
			var ua= navigator.userAgent, 
			N= navigator.appName, tem, 
			M= ua.match(/(opera|chrome|safari|firefox|msie|trident)\/?\s*([\d\.]+)/i) || [];
			M= M[2]? [M[1], M[2]]:[N, navigator.appVersion, '-?'];
			if(M && (tem= ua.match(/version\/([\.\d]+)/i))!= null) M[2]= tem[1];
			return M.join(' ');
		})();
		var sayswho = navigator.sayswho.split(' ');
		var browserName = sayswho[0];
		var browserVersion = parseFloat(sayswho[1]);
		console.log("start: navigator.sayswho=",browserName,browserVersion);
		if(browserName=="Firefox" && browserVersion>=22) {
			$('#versionInfo').hide();
		}
	} catch(err) {
		console.log("navigator.sayswho err",err);
	}

    console.log("start: connecting to signaling server",socketServerAddress);
    writeToChatLog("connecting to signaling server "+socketServerAddress+"...", "text-warning");
    websocket = new WebSocket(socketServerAddress);
	websocket.onopen = function () {
	    roomName = getUrlParameter('room');
		key = getUrlParameter('key');
		calleeKey = getUrlParameter('calleeKey');
        linkType = getUrlParameter('linktype');	// if given, this is the callee linkType
        if(!linkType) linkType = getUrlParameter('callerLinkType');	// if given, this is the caller linkType
        if(!linkType) linkType="relayed"
	    console.log("start: roomName="+roomName+" key="+key+" calleeKey="+calleeKey+" linkType="+linkType);

        if(!roomName) {
        	// roomName was NOT given by URL parameter; getRoomName -> #setRoomBtn
		    console.log("start: no roomName parameter");
            $('#getRoomName').modal('show');
		    $('#roomName').focus();
		    $('#linktyp').prop('checked', false);
        } else {
            // roomName was given by URL parameter
            // when the websocket-connection is ready, auto-subscribe the room
		    console.log("start: roomName parameter given",roomName);
            $('#waitForConnection').modal('show');
        }

        if(key) {
        	// the callee comes here (vial html link and) with a key=
        	// which will be sent to rtcSignaling.go to stop the ringing
		    console.log("start: websocket.send",{command:'stopRing', calleekey: key});
	    	websocket.send(JSON.stringify({command:'stopRing', calleekey: key}));
        }
        
        if(calleeKey) {
			// the caller comes here via caller-enter-name.js
			// providing us with &calleeKey= so we can stop the ringing in case the caller disappears
        	// which will be sent to rtcSignaling.go 
			console.log("start: websocket.send",{command:'forRing', calleekey: calleeKey});
			websocket.send(JSON.stringify({command:'forRing', calleekey: calleeKey}));
        }

	    bindSocketEvents();
	};
	websocket.onerror = function () {
		if(websocket) {
		    writeToChatLog("failed to create websocket connection", "text-success");
		    alert('failed to create websocket connection '+socketServerAddress);
		}
	}
}

function getUrlParameter(name) {
    name = name.replace(/[\[]/,"\\\[").replace(/[\]]/,"\\\]");
    var regexS = "[\\?&]"+name+"=([^&#]*)";
    var regex = new RegExp(regexS);
    var results = regex.exec(window.location.href);
    if(results != null)
        return results[1];
    return "";
}

$('#setRoomBtn').click(function() {
    // user has entered a room name
    roomNameFromForm()
});

function roomNameFromForm() {
    //console.log("roomNameFromForm() ...");
    $('#getRoomName').modal('hide');
    subscribeRoom($('#roomName').val());
}

function subscribeRoom(roomName) {
    // create a signaling room by subscribing the name
    // this is also being called directly from HTML
    if(websocket) {
		if($('#linktyp').is(':checked')) {
			// caller-requested linkType
			linkType = "p2p";
		}   
	    console.log("subscribe to roomName="+roomName+" linkType="+linkType);
    	websocket.send(JSON.stringify({command:'subscribe', room: roomName, linkType:linkType}));
        console.log("sent subscription for roomName", roomName,"now wait-for-p2p-connection...");
        $('#waitForConnection').modal('show');

        // wait for the 2nd party to join this room (maybe we are the 2nd party)
        // this will happen in addClient()
    } else {
        console.log("failed to send subscribe request over websocket connection");
        writeToChatLog("failed to send subscribe request over websocket connection", "text-success");
    }
}

function hideWaitForConnection() {
    $('#waitForConnection').modal('hide');
    $('#waitForConnection').remove();
    $('#showLocalAnswer').modal('hide');
    $('#messageTextBox').focus();
}

function handleRtcConnection() {
    console.log("handleRtcConnection");
    hideWaitForConnection();   
}

function webrtcDisconnect() {
    console.log("webrtcDisconnect...");
    // this can happen while still waiting for a webrtc connection, so we must always hide busybee
    hideWaitForConnection();
    writeToChatLog("p2p session disconnected; hit reload to restart session; hit back to ...", "text-warning");
    // TODO: alert() instead?
    webrtcDataChannel=null;
}

function pc1CreateDataChannel() {
    try {
        console.log("pc1.createDataChannel...");
        // TODO: in chrome: pc1.createDataChannel will fail with dom exception 9
        // and if it doesn't fail, it will respond with an 'empty' sdp answer
        webrtcDataChannel = pc1.createDataChannel('createdbypc1', {reliable:false});
        console.log("pc1.createDataChannel webrtcDataChannel=", webrtcDataChannel,webrtcDataChannel.label);
        if(!webrtcDataChannel) {
            writeToChatLog("pc1.createDataChannel failed", "text-success");
            return;
        }

        //var fileReceiver1 = new FileReceiver();

        webrtcDataChannel.onopen = function () {
            console.log("pc1 webrtcDataChannel.onopen");
            writeToChatLog("rtc link established", "text-warning");
            // show other ip-addr?

            // greetings: we can start sending p2p data now
            //if(webrtcDataChannel) {
            //	  console.log("pc1 webrtcDataChannel.onopen; send hello from pc1...");
            //	  var msg = "Hello from pc1";
            //	  writeToChatLog(msg, "text-success");
            //	  webrtcDataChannel.send(msg);s
            //} else {
            //    writeToChatLog("failed to send data over webrtcDataChannel", "text-success");
            //}

			if(websocket) {
				// now is a good time to force disconnect from signaling server
			    console.log("messageForward: force websocket.close()");
			    websocket.close();
			    websocket = null;
			    //writeToChatLog("disconnected from signaling server", "text-warning");
			}
        };

        webrtcDataChannel.ondisconnect = function() {
            console.log("pc1 webrtcDataChannel.ondisconnect !!!!");
            webrtcDisconnect();
        };
       
        webrtcDataChannel.onclosedconnection = function() {
            console.log("pc1 webrtcDataChannel.onclosedconnection !!!!");
            webrtcDisconnect();
        };

        webrtcDataChannel.onclose = function() {
            console.log("pc1 webrtcDataChannel.onclose !!!!");
            webrtcDisconnect();
        };

        webrtcDataChannel.onerror = function() {
            console.log("pc1 webrtcDataChannel.onerror !!!!");
            writeToChatLog("webrtc error", "text-success");
        };

        webrtcDataChannel.onmessage = function (e) {
            // msgs received by pc1
            //console.log("pc1 webrtcDataChannel.onmessage");
            //if (e.data.size) {
            //    fileReceiver1.receive(e.data, {});
            //}
            //else {
            //    var data = JSON.parse(e.data);
            //    if (data.type === 'file') {
            //        fileReceiver1.receive(e.data, {});
            //    }
            //    else {
            //        writeToChatLog(data.message, "text-info");
            //    }
            //}

			receiveMessage(e.data);
        };
    } catch (e) { console.warn("pc1.createDataChannel exception", e); }
}

function bindSocketEvents(){
	// bind server websocket events for signaling
  	console.log("bindSocketEvents", websocket);

    websocket.onmessage = function(m) { 
        var data = JSON.parse(m.data);
    	console.log("websocket message raw:", data);
    	
    	switch(data.command) {
    		case "connect":
				console.log("connect: websocket.send connect");
				// request a clientId
				websocket.send(JSON.stringify({command:'connect'}));
				break;

			case "ready":
				clientId = data.clientId;
				console.log("ready: clientId=",clientId);
				// now that we have a signaling client-id, we will create a webrtcDataChannel

				if(roomName) {
				    console.log("ready: subscribe:",roomName);
				    subscribeRoom(roomName);
				}

			    console.log("ready: RTCPeerConnection for pc1",icecfg, con);
			    pc1 = new RTCPeerConnection(icecfg, con);  // user 1 = server
			    console.log("ready: set pc1.onconnection");
			    pc1.onconnection = handleRtcConnection;

			    console.log("ready: RTCPeerConnection for pc2",icecfg, con);
			    pc2 = new RTCPeerConnection(icecfg, con);  // user 2 = client
			    console.log("ready: set pc2.onconnection");
			    pc2.onconnection = handleRtcConnection;

			    //if(getUserMedia){
			    //    getUserMedia({'audio':true, fake:true}, function (stream) {
			    //        console.log("Got local audio", stream);
			    //        pc1.addStream(stream);
			    //    }, function (err) { console.warn("getUserMedia error",err); });
			    //} else {
			    //    //alert('Your browser does not support the getUserMedia() API.');
			    //    console.log("Your browser does not support the getUserMedia() API");
			    //    writeToChatLog("Your browser does not support the getUserMedia() API");
			    //} 

			    if (navigator.mozGetUserMedia) {
			        console.log("ready: pc1CreateDataChannel()");
			        pc1CreateDataChannel();
			    } else {
			        console.log("ready: not getting data channel for ",navigator.mozGetUserMedia);
			    }

			    pc2.ondatachannel = function (e) {
			        webrtcDataChannel = e.channel || e; // Chrome sends event, FF sends raw channel
			        console.log("pc2.ondatachannel set webrtcDataChannel",
			        	webrtcDataChannel,webrtcDataChannel.label);
			        if(!webrtcDataChannel) {
			            writeToChatLog("failed to create webrtc dataChannel", "text-success");
			            return;
			        }

			        //var fileReceiver2 = new FileReceiver();

			        webrtcDataChannel.onopen = function () {
			            console.log("pc2 webrtcDataChannel.onopen");
			            writeToChatLog("rtc link established", "text-warning");
				        // shall we show other client's ip-addr?

				        // greetings: we can now start to send p2p data
				        //if(webrtcDataChannel) {
			            //    console.log("pc2 webrtcDataChannel.onopen; send hello from pc2...");
			            //    var msg = "Hello from pc2";
			            //    writeToChatLog(msg, "text-success");
			            //    webrtcDataChannel.send(msg);
				        //} else {
				        //    writeToChatLog("failed to send data over webrtcDataChannel", "text-success");
				        //}

		                if(websocket) {
			                // now is a good time to force disconnect from signaling server
							console.log("webrtcDataChannel.onopen: force websocket.close()");
							websocket.close();
							websocket = null;
							//writeToChatLog("disconnected from signaling server", "text-warning"); 
		                }
			        };

			        webrtcDataChannel.ondisconnect = function() {
			            console.log("pc2 webrtcDataChannel.ondisconnect !!!!");
			            webrtcDisconnect();
			        };

			        webrtcDataChannel.onclosedconnection = function() {
			            console.log("pc2 webrtcDataChannel.onclosedconnection !!!!");
			            webrtcDisconnect();
			        };

			        webrtcDataChannel.onclose = function() {
			            console.log("pc2 webrtcDataChannel.onclose");
			            webrtcDisconnect();
			        };

			        webrtcDataChannel.onerror = function() {
			            console.log("pc2 webrtcDataChannel.onerror");
			            writeToChatLog("webrtc error", "text-success");
			        };

			        webrtcDataChannel.onmessage = function (e) {
			            // msgs received by user 2
			            //console.log("pc2 webrtcDataChannel.onmessage");
					    //if (e.data.size) {
					    //    fileReceiver2.receive(e.data, {});
					    //}
					    //else {
					    //    var data = JSON.parse(e.data);
					    //    if (data.type === 'file') {
					    //        fileReceiver2.receive(e.data, {});
					    //    }
					    //    else {
					    //        //writeToChatLog(data.message, "text-info");
					    //        // Scroll chat text area to the bottom on new input.
					    //        //$('#chatlog').scrollTop($('#chatlog')[0].scrollHeight);
					    //    }
					    //}

                        receiveMessage(e.data);
			        };
			    };

			    pc2.onaddstream = function (e) {
			        console.log("pc2 got remote stream", e);
			        var el = new Audio();
			        el.autoplay = true;
			        attachMediaStream(el, e.stream);
			    };

			    // pc1.onicecandidate = function (e) {
			    //     console.log("pc1.onicecandidate");
			    //     // This is for Chrome - MOZ has e.candidate alway set to null
			    //     if (!navigator.mozGetUserMedia) {
			    //  	   // TODO chrome?
			    //  	   if (e.candidate) {
			    //             if (e.candidate.candidate) {
			    //                 console.log("ICE candidate (pc1)", JSON.stringify(e.candidate.candidate));
			    //                 pc2.addIceCandidate(e.candidate.candidate);
			    //             } else {
			    //         	       console.log("ICE candidate (pc1) - no candidate");
			    //             }
			    //      
			    //         } else {
			    //             console.log("ICE candidate (pc1) no e.candidate", e);
			    //         }
			    //     }
			    // };

			    if (!navigator.mozGetUserMedia) {
			        pc1.onicecandidate = function (e) {
			            if(e & e.candidate)
			                pc2.addIceCandidate(e.candidate);
			        }
			        pc2.onicecandidate = function (e) {
			            if(e & e.candidate)
			                pc1.addIceCandidate(e.candidate);
			        }
			    }
				break;

			case "roomclients":
				// set the current room
				currentRoom = data.room;
				clientCount=0;  // will be raised by addClient()
				console.log("roomclients setCurrentRoom",currentRoom," data.clients.length",data.clients.length);
		
				// add the other clients (if any) to the clients list
				for(var i = 0, len = data.clients.length; i < len; i++){
					if(data.clients[i]) {
						addClient(data.clients[i], false);
					}
				}
				// add myself
				if(clientId) {
				    console.log("roomclients addClient myself",clientId);
					addClient({ clientId: clientId }, true);
				}
				break;
			
			case "presence":
				if(data.state == 'online'){
				    console.log("presence online: other client entered the room",clientCount);
					addClient(data.client, false);
				} else if(data.state == 'offline') {
					if(clientCount>0) {
					    clientCount--;
				        console.log("other client left signaling servers",clientCount);
				        if(websocket) {
				            websocket.close();
				            websocket = null;
				            //writeToChatLog("disconnected from signaling server", "text-warning");
				        }
					    hideWaitForConnection();
					} else {
				        console.log("presence offline - while no clients registered");
					}
				}
				break;

			case "messageForward":
				var message = data.message;
			    console.log("messageForward: ",message);
				if(!message) {
				    console.log("messageForward: message is empty - abort");
					return;
				}

				var msgType = data.msgType;
				if(msgType=="message") {
                    receiveMessage(message);
					return;
				}
				if(msgType=="serverconnect") {
    			    console.log("messageForward: serverconnect");
                    hideWaitForConnection();
					return;
				}

				if(IAmUser==2) {
				    // step 1: user 2 is receiving an offer from user 1
				    console.log("user 2 received remote offer", JSON.parse(message));
				    localOffer = null;
				    var offerDesc = new RTCSessionDescription(JSON.parse(message));
				    console.log("user 2 received remote offerDesc", offerDesc);

				    pc2.setRemoteDescription(offerDesc,function () {
				        console.log("user 2 setRemoteDescription offerDesc done; create answer...");
				        pc2.createAnswer(function (answerDesc) {
				            // TODO: chrome failes here with 0.0.0.0
				            console.log("user 2 created local answer", JSON.stringify(answerDesc));
				            localOffer = answerDesc;
				            // PeerConnection won't start gathering candidates until setLocalDescription() called
				            pc2.setLocalDescription(answerDesc, function () {
				                console.log("user 2 setLocalDescription done");
				                // send our answerDesc via signaling server room to user 1
				                if(websocket) {
				                    console.log("user 2 send answerDesc to user 1 via selected room...");
				                    // TODO: end-to-end encrypt answerDesc, so only the other party can read it
						    		websocket.send(JSON.stringify({
						    			command:'messageForward', 
						    			msgType:'answer', 
						    			message: JSON.stringify(answerDesc)
						    		}));

						            // user 1 will call pc1.setRemoteDescription()                       
				                    // and wait for the p2p connection
				                    console.log("user 2 wait for the p2p connection...");
				                    $('#waitForConnection').modal('show');
				                    // TODO: timeout needed?
				                } else {
				                    console.log("user 2 failed to send data over websocket connection");
				                    writeToChatLog("failed to send data over websocket connection", "text-success");
				                }
				            }, function () { console.warn("user 2 failed to setLocalDescription"); });
				        }, function () { console.warn("user 2 failed to createAnswer"); });
				    }, function () { console.warn("user 2 failed to setRemoteDescription"); });

					window.setTimeout(function(){
						if(!localOffer) {
						    console.warn("Failed to create answer. A known error. Please restart browser.");
				            alert('Failed to create answer. This is a known error. Please restart browser.');
						}
				    },5000);

				} else if(IAmUser==1) {
				    // step 2: user 1 is receiving an offer back in response from user 2
				    console.log("user 1 received remote answer", message);
				    var answerDesc = new RTCSessionDescription(JSON.parse(message));

				    console.log("user 1 setRemoteDescription answerDesc:", answerDesc);
				    pc1.setRemoteDescription(answerDesc, function () {
				        console.log("user 1 setRemoteDescription answerDesc done");
				        if (navigator.mozGetUserMedia) {   
				        	// FOR MOZ USER AGENT ONLY
				            // NOTE: only user 1 does this
				            console.log("user 1 moz: call connectDataConnection(); wait for rtc-p2p...",pc1,pc2);
				            var port1 = Date.now();
				            var port2 = port1 + 1;
				            pc1.connectDataConnection(port1,port2);
				            pc2.connectDataConnection(port2,port1);
				            // websocket will be closed .ondatachannel
				        } else {
				            console.log("user 1 chrome: NOT call connectDataConnection(); wait for rtc-p2p...");
				            // TODO: something missing for chrome?
				        }
				        $('#waitForConnection').modal('show');
				    }, function () { 
				        // - pc1 receives this when talking to chrome/chromium as pc2 
				        //   because chromium sendes an empty sdp answer - or one with 0.0.0.0
				        console.warn("pc1.setRemoteDescription failed"); 
				        webrtcDisconnect();
				    });

				} else {
				    console.log("unknown user received remote offer", message);
				}
				break;

			case "consoleMessage":
				var message = data.message;
                console.log("consoleMessage: "+message);
                writeToChatLog(message, "text-warning");
                if(message.indexOf("using p2p")>=0) {
				    $('#fileBtn').show(1000);
                } else if(message.indexOf("using relayed")>=0) {
				    $('#fileBtn').hide();
                }
				break;
		}
    }

    console.log("bindSocketEvents done");
    // if no server is found, we will not receive events 'connect', 'roomclients' and 'ready'
    // let's check if we obtained a clientId within 5 seconds
	window.setTimeout(function(){
	    if(!clientId) {
            writeToChatLog("Failed to retrieve clientId. Server connectivity issue.", "text-success");
            alert("Failed to retrieve clientId. There may be a server connectivity issue.");
            $('#waitForConnection').modal('hide');
	    }
    },5000);
}

// a new client has entered the room
function addClient(client, isMe){
    clientCount++;
	if(isMe){
	    // it's just me who has entered the room
        console.log("addClient isMe wait...",client.clientId,clientCount);
        // we are waiting for onconnect -> handleRtcConnection

	} else {
	    // the other user has arrived in the room
	    if(clientCount==2) {
	        IAmUser=1;
            if (!navigator.mozGetUserMedia) {
                pc1CreateDataChannel();
                console.log("addClient chrome webrtcDataChannel=", webrtcDataChannel);
            }

            if(webrtcDataChannel) {
                console.log("addClient !isMe IAmUser=1 createoffer",client.clientId, clientCount);
                localOffer = null;
                pc1.createOffer(function (offerDesc) {
                    console.log("addClient created local offer", offerDesc);
                    if(offerDesc) {
                        localOffer = offerDesc;
                        // PeerConnection won't start gathering candidates until setLocalDescription() is called
                        console.log("addClient pc1.setLocalDescription");
                        pc1.setLocalDescription(offerDesc, function () {
                            // send offerDesc as signaling server message to user 2
                            if(websocket) {
                                console.log("addClient websocket.send('messageForward','offer')");
						    	websocket.send(JSON.stringify({
						    		command:'messageForward', 
					    			msgType:'offer', 
						    		message: JSON.stringify(offerDesc), 
						    		room:currentRoom  // needed ???
						    	}));

                                // now wait for the response from user 2 via signaling server room
                                // TODO: implement a timeout? can't wait forever for a response to our offer!
                                // we are waiting for answerDesc under if(IAmUser==1)
                            } else {
                                console.log("addClient failed to send messageForward over websocket connection')");
                                writeToChatLog("failed to send messageForward over websocket connection", 
                                	"text-success");
                            }
                        }, function () { console.warn("pc1.setLocalDescription failed"); });
                    }
                }, function () { console.warn("pc1.createOffer failed"); });

                console.log("pc1.createOffer called");
                // function (offerDesc) may not be called!!!
                // if this happens, this is a firefox 22 bug. firefox needs to be restarted.
                // setTimeout and check if localOffer is set
        		window.setTimeout(function() {
        		    if(!localOffer) {
        		        console.warn("Failed to create offer. This is a known error. Please restart browser.");
        		        alert("Failed to create offer. This is a known error. Please restart browser.");
        		    }
                },5000);
            } else {
            	// webrtcDataChannel was not set by pc1CreateDataChannel()
   		        console.warn("no webrtcDataChannel");
            }

	    } else {
	        IAmUser=2;
            console.log("addClient !isMe IAmUser=2 ",client.clientId,clientCount);
            // we wait for offer from user 1; will arrive via messageForward
	    }
	}
}


function linkify(text) {
    // http://stackoverflow.com/questions/37684/how-to-replace-plain-urls-with-links
    // http://benalman.com/code/test/js-linkify/
    var exp = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
    return text.replace(exp,"<a href='$1' target='_blank'>$1</a>"); 
}

var arrayBufferChunks = [], meta = {};
var downloadBase64 = "";
var downloadStartTime = 0;

function receiveMessage(msg) {
	var data;
	try {
		data = JSON.parse(msg);
	} catch(err) {
		// plain text message
		var text = linkify(msg);
		console.log("receiveMessage text",text);
		document.getElementById('audiotag').play();
		writeToChatLog("other: "+text, "text-info");
		return;
	}

	if(data.status == 'start') {
		// step 1: store the meta data temporarily
		meta = data;
		downloadBase64 = "";
		downloadStartTime = new Date().getTime()
		console.log("receiveMessage start",meta);

	} else if(data.status == 'data') {
		if(downloadBase64=="") {
			var b64 = data.data.split(",")
			downloadBase64 = b64[1];
		} else {
			downloadBase64 += data.data;
		}
		var byteCount = downloadBase64.length // brutto
		var downloadDurationMs = new Date().getTime() - downloadStartTime;
		var downloadDurationDisplay = Math.round(downloadDurationMs/10)/100;
		var kbytesPerSecDisplay = Math.round((byteCount*100) / downloadDurationMs) / 100;
		console.log("receiveMessage data "+byteCount+" bytes "+
						downloadDurationDisplay+"s "+kbytesPerSecDisplay+" KB/s");

	} else if(data.status == 'complete') {
		// step 3: create an object URL for a download link
		var binaryData = atob(downloadBase64);
		var byteCount = binaryData.length; // netto
		console.log("receiveMessage complete wire-bytecount="+downloadBase64.length+" binary-bytecount="+byteCount);
		// put binaryData into Blob so it can be stored
		var ab = new ArrayBuffer(byteCount);
		var ua = new Uint8Array(ab);
		for (var i = 0; i < byteCount; i++) {
		    ua[i] = binaryData.charCodeAt(i);
		}
		var blob = new Blob([ua], { "type" : meta.type});

		var downloadDurationMs = new Date().getTime() - downloadStartTime;
		var downloadDurationDisplay = Math.round(downloadDurationMs/10)/100;
		var bytesPerSec = byteCount / (downloadDurationMs/1000);
		var kbytesPerSecDisplay = Math.round(bytesPerSec/10)/100;
		var dlMsg = ""+byteCount+" bytes "+downloadDurationDisplay+"s "+kbytesPerSecDisplay+" KB/s";
		console.log("receiveMessage complete "+dlMsg);

		var dlLink = '<a href="'+URL.createObjectURL(blob)+'" download="'+meta.name+'">'+meta.name+'</a>';
		writeToChatLog("received file: "+dlLink+" "+dlMsg, "text-info");
		document.getElementById('audiotag').play();
		downloadBase64 = ""
		meta = {}
	} 
}

$('#fileBtn').change(function() {
    var file = this.files[0];
    sendFile(file);
    $('#messageTextBox').focus();
});

function sendFile(file) {
    console.log("sendFile",file,file.size);
    if (file.size) {
	    $('#fileBtn').hide();

		webrtcDataChannel.send(JSON.stringify({ //json
            name: file.name,
            type: file.type,
            status: 'start'
        }));

		var chunkSize = 64000,
			fileSize = 0,
			textToTransfer = '',
			numberOfPackets = 0,
			packet = 0;
				    
		function onReadAsDataURL(event,text) {
			if(event) {
				textToTransfer = event.target.result;
				fileSize = textToTransfer.length;
				numberOfPackets = parseInt(fileSize / chunkSize);
			    console.log("sendFile onload fileSize="+fileSize+" numberOfPackets="+numberOfPackets);
			    packet = 0;
			}

			var from = packet * chunkSize;
			var to = from + chunkSize;
			console.log("sendFile packet="+packet+" bytes="+to);
			webrtcDataChannel.send(JSON.stringify({
				status: 'data',
				data: textToTransfer.slice(from,to)
			}));

			packet++;
			if(packet<numberOfPackets) {
		        setTimeout(function () {
		            onReadAsDataURL(null, null);
		        }, 20);
			} else {
				from = from + chunkSize;
				if(fileSize>from) {
					console.log("sendFile last packet="+packet+" from="+from+" to=fileSize="+fileSize);
					webrtcDataChannel.send(JSON.stringify({
						status: 'data',
						data: textToTransfer.slice(from,fileSize)
					}));
				}
				webrtcDataChannel.send(JSON.stringify({
				    status: 'complete'
				}));
			    $('#fileBtn').show();
				writeToChatLog("sent file: "+file.name+" "+fileSize+" bytes");
			}
		}

        var reader = new window.FileReader();
        reader.readAsDataURL(file);
        reader.onload = onReadAsDataURL;
    }
}

function sendMessage(msg) {
    console.log("sendMessage", msg);
    if (msg) {
        $('#messageTextBox').val("");
        if(webrtcDataChannel) {
            webrtcDataChannel.send(msg);
            msg = linkify(msg);
            writeToChatLog(msg, "text-success");
        } else {
            writeToChatLog("sendMessage failed no webrtcDataChannel", "text-success");
        }
    }

    return false;
};

function sendMessageFromForm() {
    //console.log("sendMessageFromForm() -> sendMessage()",$('#messageTextBox').val());
    sendMessage($('#messageTextBox').val());
    $('#messageTextBox').focus();
}

$('#sendMessageBtn').click(function() {
    sendMessageFromForm();
});

function getTimestamp() {
    var totalSec = new Date().getTime() / 1000;
    var hours = parseInt(totalSec / 3600) % 24;
    var minutes = parseInt(totalSec / 60) % 60;
    var seconds = parseInt(totalSec % 60);
    return result = (hours < 10 ? "0" + hours : hours) + ":" +
                    (minutes < 10 ? "0" + minutes : minutes) + ":" +
                    (seconds  < 10 ? "0" + seconds : seconds);
}

function writeToChatLog(message, message_type) {
    var msg = message;
    document.getElementById('chatlog').innerHTML 
    	+= '<p class=\"'+message_type+'\">'+'['+getTimestamp()+'] '+msg+'</p>';
    // Scroll chat text area to the bottom on new input.
    $('#chatlog').scrollTop($('#chatlog')[0].scrollHeight);
}

