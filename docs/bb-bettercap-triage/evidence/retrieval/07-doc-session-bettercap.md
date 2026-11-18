# symbol: Session

5 file(s) and 5 symbol(s) in scope, 50 cited claim(s) across 5 section(s) from 250 source(s).

## API

10 claims, 10 read directly from the index, resting on 5 sources (1 symbol).

-  _(100%)_ property Session: \*Session is defined in session/module.go at lines 35-35.[1]
-  _(100%)_ Session is declared public.[1]
-  _(100%)_ property Session: \*session.Session is defined in modules/c2/c2.go at lines 46-46.[3]
-  _(100%)_ Session is declared public.[3]
-  _(100%)_ property Session: session.Session is defined in modules/net\_probe/net\_probe\_test.go at lines 67-67.[5]
-  _(100%)_ Session is declared public.[5]
-  _(100%)_ struct Session is defined in session/session.go at lines 72-98.[7]
-  _(100%)_ Session is declared public.[7]
-  _(100%)_ property Session: session.Session is defined in modules/arp\_spoof/arp\_spoof\_test.go at lines 110-110.[9]
-  _(100%)_ Session is declared public.[9]

## Behavior

10 claims, 10 read directly from the index, resting on 5 sources (1 symbol). Read from the index and, where the index has none, from the comment block above the definition on disk.

-  _(100%)_ Session is defined in session/module.go at line 35 and returns \*Session.[1]
-  _(100%)_ Session has a measured complexity of 1.[1]
-  _(100%)_ Session is defined in modules/c2/c2.go at line 46 and returns \*session.Session.[3]
-  _(100%)_ Session has a measured complexity of 1.[3]
-  _(100%)_ Session is defined in modules/net\_probe/net\_probe\_test.go at line 67 and returns session.Session.[5]
-  _(100%)_ Session has a measured complexity of 1.[5]
-  _(100%)_ Session is defined in session/session.go at line 72.[7]
-  _(100%)_ Session has a measured complexity of 1.[7]
-  _(100%)_ Session is defined in modules/arp\_spoof/arp\_spoof\_test.go at line 110 and returns session.Session.[9]
-  _(100%)_ Session has a measured complexity of 1.[9]

## Dependencies

20 claims, 20 read directly from the index, resting on 20 sources (1 relationship). Edges are read from the graph; an edge whose target the index did not resolve is marked inferred.

-  _(70%)_ NewPacketProxy references Session.[11]
-  _(70%)_ testSession references Session.[12]
-  _(70%)_ NewBLERecon references Session.[13]
-  _(70%)_ CommandHandler references Session.[14]
-  _(70%)_ createMockSession references Session.[15]
-  _(70%)_ NewDiscovery references Session.[16]
-  _(70%)_ NewHttpsProxy references Session.[17]
-  _(70%)_ NewCommandHandler references Session.[18]
-  _(70%)_ LANCompleterForMacs references Session.[19]
-  _(70%)_ sendProbeNBNS uses Session.[20]
-  _(70%)_ sendProbeUPNP uses Session.[21]
-  _(70%)_ sendProbeWSD uses Session.[22]
-  _(70%)_ NewAnyProxy references Session.[23]
-  _(70%)_ PromptCallbacks references Session.[24]
-  _(70%)_ NewHttpServer references Session.[25]
-  _(70%)_ TestCertConfigToModule instantiates Session.[26]
-  _(70%)_ routeMon references Session.[27]
-  _(70%)_ NewCapletsModule references Session.[28]
-  _(70%)_ LoadDnsProxyScript references Session.[29]
-  _(70%)_ LoadHttpProxyScript references Session.[30]

## Tests

5 claims, 2 read directly from the index; 3 inferred because the index did not resolve the target, resting on 5 sources (1 test).

-  _(70%)_ Session is named in the test source modules/any\_proxy/any\_proxy\_test.go, but no indexed relationship connects them.[2]
-  _(70%)_ Session is named in the test source modules/any\_proxy/any\_proxy\_test.go, but no indexed relationship connects them.[4]
-  _(100%)_ Session has indexed test evidence in modules/net\_probe/net\_probe\_test.go.[6]
-  _(70%)_ Session is named in the test source modules/any\_proxy/any\_proxy\_test.go, but no indexed relationship connects them.[8]
-  _(70%)_ Session has indexed test evidence in tls/tls\_test.go, modules/any\_proxy/any\_proxy\_test.go, modules/c2/c2\_test.go, modules/api\_rest/api\_rest\_test.go, modules/can/can\_test.go, modules/arp\_spoof/arp\_spoof\_test.go, modules/ble/ble\_recon\_test.go, modules/http\_proxy/http\_proxy\_test.go, modules/net\_recon/net\_recon\_test.go, modules/ticker/ticker\_test.go.[10]

## Limitations

5 claims, 5 read directly from the index, resting on 5 sources (1 symbol). What this document cannot say is stated here rather than filled in.

-  _(100%)_ Session has no indexed docstring, and this language uses a comment marker this tool's source reader does read, so the absence of documentation is a finding about the code.[1]
-  _(100%)_ Session has no indexed docstring, and this language uses a comment marker this tool's source reader does read, so the absence of documentation is a finding about the code.[3]
-  _(100%)_ Session has no indexed docstring, and this language uses a comment marker this tool's source reader does read, so the absence of documentation is a finding about the code.[5]
-  _(100%)_ Session has no indexed docstring, and this language uses a comment marker this tool's source reader does read, so the absence of documentation is a finding about the code.[7]
-  _(100%)_ Session has no indexed docstring, and this language uses a comment marker this tool's source reader does read, so the absence of documentation is a finding about the code.[9]

## Unknowns

- No docstring was indexed for Session and none is present in the comment style this tool reads. _(not-observed, affects: behavior)_
- The per-section evidence cap is 20 at detail "standard", so 215 of 235 dependencies items were not selected. The output budget may have shortened this further; it reports its own count. _(output-budget, affects: dependencies)_

## Quality

- passed: true
- factuality: true (0 uncited claim(s))
- references: true (0 broken, 0 stale, 0 missing)
- completeness: true (5/5 required sections, 2 unknown(s))
- budget: true (2302/8000 tokens)
- snapshot: `19c43df39d20653a26b9e9dccefd1838`

## Sources

- [1](session/module.go#L35) — symbol: Indexed property Session
- [2](modules/any_proxy/any_proxy_test.go) — test: Test source references Session — unknown
- [3](modules/c2/c2.go#L46) — symbol: Indexed property Session
- [4](modules/any_proxy/any_proxy_test.go) — test: Test source references Session — unknown
- [5](modules/net_probe/net_probe_test.go#L67) — symbol: Indexed property Session
- [6](modules/net_probe/net_probe_test.go) — test: Test file references Session
- [7](session/session.go#L72-L98) — symbol: Indexed struct Session
- [8](modules/any_proxy/any_proxy_test.go) — test: Test source references Session — unknown
- [9](modules/arp_spoof/arp_spoof_test.go#L110) — symbol: Indexed property Session
- [10](tls/tls_test.go) — test: Test file references Session — unknown
- [11](modules/packet_proxy/packet_proxy_freebsd.go#L11) — relationship references: references edge between NewPacketProxy and Session — unknown
- [12](modules/c2/c2_test.go#L12) — relationship references: references edge between testSession and Session — unknown
- [13](modules/ble/ble_unsupported.go#L14) — relationship references: references edge between NewBLERecon and Session — unknown
- [14](session/command_handler.go#L16) — relationship references: references edge between CommandHandler and Session — unknown
- [15](modules/c2/c2_test.go#L16) — relationship references: references edge between createMockSession and Session — unknown
- [16](modules/net_recon/net_recon.go#L17) — relationship references: references edge between NewDiscovery and Session — unknown
- [17](modules/https_proxy/https_proxy.go#L17) — relationship references: references edge between NewHttpsProxy and Session — unknown
- [18](session/command_handler.go#L19) — relationship references: references edge between NewCommandHandler and Session — unknown
- [19](session/session_completers.go#L19) — relationship references: references edge between LANCompleterForMacs and Session — unknown
- [20](modules/net_probe/net_probe_nbns.go#L19) — relationship uses: uses edge between sendProbeNBNS and Session — unknown
- [21](modules/net_probe/net_probe_upnp.go#L19) — relationship uses: uses edge between sendProbeUPNP and Session — unknown
- [22](modules/net_probe/net_probe_wsd.go#L19) — relationship uses: uses edge between sendProbeWSD and Session — unknown
- [23](modules/any_proxy/any_proxy.go#L20) — relationship references: references edge between NewAnyProxy and Session — unknown
- [24](session/prompt.go#L20) — relationship references: references edge between PromptCallbacks and Session — unknown
- [25](modules/http_server/http_server.go#L20) — relationship references: references edge between NewHttpServer and Session — unknown
- [26](tls/tls_test.go#L22) — relationship instantiates: instantiates edge between TestCertConfigToModule and Session — unknown
- [27](session/session_routing.go#L23) — relationship references: references edge between routeMon and Session — unknown
- [28](modules/caplets/caplets.go#L23) — relationship references: references edge between NewCapletsModule and Session — unknown
- [29](modules/dns_proxy/dns_proxy_script.go#L23) — relationship references: references edge between LoadDnsProxyScript and Session — unknown
- [30](modules/http_proxy/http_proxy_script.go#L23) — relationship references: references edge between LoadHttpProxyScript and Session — unknown

