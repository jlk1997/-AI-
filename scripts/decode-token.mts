const token =
  'eyJib2R5Ijoie1widlwiOjEsXCJkZXBsb3ltZW50SWRcIjpcImY4NTU4OWIxLTA3NzUtNGQ0Zi1hYmZjLTRiM2I4YzgzYmE1ZlwiLFwiZXhwXCI6MTc4NjQ3ODEyOSxcImRpc3RQcmVmaXhcIjpcInByb2plY3RzLzlhYzcxZTIyLTJhOGItNDIxZi1hMzI1LTY5N2U2NDNkYjE1YS9hcnRpZmFjdHMvZGU0NjI0NzAtYTc1MS00OGJjLWJkZmYtNjg2YWRiMTM3ZjJmL2Rpc3RcIn0iLCJzaWciOiIyX2hFVDdUUU1uUUhmV3hXdUw5NHhubXJlelRieEtLU1lUWU1jNEJ1cEFZIn0';
const raw = Buffer.from(token, 'base64url').toString('utf8');
const parsed = JSON.parse(raw);
const body = JSON.parse(parsed.body);
console.log(JSON.stringify(body, null, 2));
console.log('has 4c8b', body.distPrefix.includes('4c8b'));
console.log('has 48bc', body.distPrefix.includes('48bc'));
