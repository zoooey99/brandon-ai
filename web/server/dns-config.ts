// Force IPv4 DNS resolution - MUST be imported before any network modules
// Render (and many cloud providers) don't support IPv6
import dns from "dns";
dns.setDefaultResultOrder('ipv4first');
